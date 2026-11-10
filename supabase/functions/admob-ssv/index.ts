import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {
  fetchAdMobPublicKeys,
  parseSignedQuery,
  validateRewardEvent,
  verifyCallbackSignature,
} from '../_shared/admob-ssv.mjs';

const KEY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let cachedKeys: Map<string, string> | null = null;
let cachedKeysAt = 0;

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function loadKeys(force = false): Promise<Map<string, string>> {
  const now = Date.now();
  if (!force && cachedKeys && now - cachedKeysAt < KEY_CACHE_TTL_MS) return cachedKeys;
  cachedKeys = await fetchAdMobPublicKeys(fetch);
  cachedKeysAt = now;
  return cachedKeys;
}

function getServiceKey(): string | null {
  const encodedKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (encodedKeys) {
    try {
      const keys = JSON.parse(encodedKeys);
      if (typeof keys.default === 'string') return keys.default;
    } catch {
      console.error('SUPABASE_SECRET_KEYS is not valid JSON');
    }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || null;
}

function allowedUnits(): string[] {
  return (Deno.env.get('ADMOB_ALLOWED_AD_UNITS') || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'GET') return jsonResponse({ error: 'method_not_allowed' }, 405);

  let parsed;
  try {
    const rawQuery = new URL(request.url).search.slice(1);
    parsed = parseSignedQuery(rawQuery);
  } catch (error) {
    return jsonResponse({ error: 'invalid_callback', detail: error instanceof Error ? error.message : 'invalid query' }, 400);
  }

  let publicKey: string | undefined;
  try {
    let keys = await loadKeys();
    publicKey = keys.get(parsed.keyId);
    if (!publicKey) {
      keys = await loadKeys(true);
      publicKey = keys.get(parsed.keyId);
    }
  } catch (error) {
    console.error('Unable to load AdMob verification keys', error);
    return jsonResponse({ error: 'verification_keys_unavailable' }, 503);
  }
  if (!publicKey) return jsonResponse({ error: 'unknown_key_id' }, 503);

  let signatureIsValid = false;
  try {
    signatureIsValid = await verifyCallbackSignature(parsed.signedData + '&signature=' + parsed.signature + '&key_id=' + parsed.keyId, publicKey);
  } catch (error) {
    console.error('AdMob signature verification failed', error);
  }
  if (!signatureIsValid) return jsonResponse({ error: 'invalid_signature' }, 400);

  const rewardItem = Deno.env.get('ADMOB_REWARD_ITEM') || '';
  const rewardAmount = Number(Deno.env.get('ADMOB_REWARD_AMOUNT'));
  const units = allowedUnits();
  if (!units.length || !rewardItem || !Number.isSafeInteger(rewardAmount) || rewardAmount < 1) {
    return jsonResponse({ error: 'ssv_not_configured', credited: false }, 503);
  }

  const config = {
    allowedAdUnits: units,
    rewardItem,
    rewardAmount,
    maxEventAgeMs: Number(Deno.env.get('ADMOB_MAX_EVENT_AGE_MS')) || 7 * 24 * 60 * 60 * 1000,
    expectedCustomData: Deno.env.get('ADMOB_EXPECTED_CUSTOM_DATA') || '',
  };
  const validation = validateRewardEvent(parsed.params, config);
  if (!validation.ok) {
    console.warn('Verified AdMob callback was not credited', validation.reason);
    return jsonResponse({ credited: false, reason: validation.reason }, 200);
  }

  const projectUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = getServiceKey();
  if (!projectUrl || !serviceKey) {
    console.error('Supabase server credentials are unavailable');
    return jsonResponse({ error: 'ledger_unavailable' }, 503);
  }

  const headers: Record<string, string> = {
    apikey: serviceKey,
    'content-type': 'application/json',
  };
  if (serviceKey.startsWith('eyJ')) headers.authorization = 'Bearer ' + serviceKey;

  const rpcResponse = await fetch(projectUrl + '/rest/v1/rpc/credit_admob_reward', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      p_transaction_id: validation.event.transactionId,
      p_user_id: validation.event.userId,
      p_ad_unit: validation.event.adUnit,
      p_reward_amount: validation.event.rewardAmount,
      p_reward_item: validation.event.rewardItem,
      p_event_timestamp_ms: validation.event.timestampMs,
    }),
  });

  if (rpcResponse.status === 400 || rpcResponse.status === 404) {
    console.warn('Verified callback references an unlinked app user');
    return jsonResponse({ credited: false, reason: 'user_not_linked' }, 200);
  }
  if (!rpcResponse.ok) {
    console.error('Reward ledger RPC failed with HTTP ' + rpcResponse.status);
    return jsonResponse({ error: 'ledger_write_failed' }, 503);
  }

  const inserted = await rpcResponse.json();
  return jsonResponse({
    credited: inserted === true,
    duplicate: inserted === false,
    transaction_id: validation.event.transactionId,
  });
});

