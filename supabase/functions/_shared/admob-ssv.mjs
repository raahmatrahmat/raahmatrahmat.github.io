export const ADMOB_PUBLIC_KEYS_URL = 'https://www.gstatic.com/admob/reward/verifier-keys.json';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRANSACTION_RE = /^[0-9a-f]{16,128}$/i;
export const IN_GAME_REWARD_ITEMS = Object.freeze([
  'points',
  'game_points',
  'coins',
  'gems',
  'diamonds',
  'pearls',
  'game_gold',
  'lives',
  'energy',
  'boosters',
  'skins',
  'cosmetics',
]);

export function isAllowedGameRewardItem(value) {
  return typeof value === 'string' && IN_GAME_REWARD_ITEMS.includes(value.toLowerCase());
}

export function base64ToBytes(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function readDerLength(bytes, cursor) {
  const first = bytes[cursor.offset++];
  if (first === undefined) throw new Error('Truncated DER length');
  if ((first & 0x80) === 0) return first;
  const byteCount = first & 0x7f;
  if (byteCount === 0 || byteCount > 2 || cursor.offset + byteCount > bytes.length) {
    throw new Error('Invalid DER length');
  }
  let length = 0;
  for (let index = 0; index < byteCount; index += 1) {
    length = (length << 8) | bytes[cursor.offset++];
  }
  return length;
}

function readDerInteger(bytes, cursor, partLength) {
  if (bytes[cursor.offset++] !== 0x02) throw new Error('Expected DER integer');
  const length = readDerLength(bytes, cursor);
  const end = cursor.offset + length;
  if (length < 1 || end > bytes.length) throw new Error('Invalid DER integer');
  let integer = bytes.slice(cursor.offset, end);
  cursor.offset = end;
  while (integer.length > 1 && integer[0] === 0) integer = integer.slice(1);
  if (integer.length > partLength) throw new Error('ECDSA integer is too large');
  const padded = new Uint8Array(partLength);
  padded.set(integer, partLength - integer.length);
  return padded;
}

export function ecdsaDerToP1363(signature, partLength = 32) {
  const bytes = signature instanceof Uint8Array ? signature : new Uint8Array(signature);
  const cursor = { offset: 0 };
  if (bytes[cursor.offset++] !== 0x30) throw new Error('Expected DER sequence');
  const sequenceLength = readDerLength(bytes, cursor);
  if (cursor.offset + sequenceLength !== bytes.length) throw new Error('Invalid DER sequence size');
  const r = readDerInteger(bytes, cursor, partLength);
  const s = readDerInteger(bytes, cursor, partLength);
  if (cursor.offset !== bytes.length) throw new Error('Unexpected DER data');
  const raw = new Uint8Array(partLength * 2);
  raw.set(r, 0);
  raw.set(s, partLength);
  return raw;
}

export function parseSignedQuery(rawQuery) {
  const marker = '&signature=';
  const signatureOffset = rawQuery.lastIndexOf(marker);
  if (signatureOffset < 0 || rawQuery.indexOf(marker) !== signatureOffset) {
    throw new Error('Missing or repeated signature parameter');
  }

  const signedData = rawQuery.slice(0, signatureOffset);
  const tail = rawQuery.slice(signatureOffset + 1);
  const signatureMatch = /^signature=([^&]+)&key_id=([0-9]+)$/.exec(tail);
  if (!signatureMatch) throw new Error('Expected signature and key_id as final parameters');

  const params = new URLSearchParams(signedData);
  const requiredNames = ['ad_unit', 'reward_amount', 'reward_item', 'timestamp', 'transaction_id'];
  for (const name of requiredNames) {
    if (params.getAll(name).length !== 1 || !params.get(name)) {
      throw new Error('Missing or repeated ' + name);
    }
  }

  return {
    signedData,
    signature: signatureMatch[1],
    keyId: signatureMatch[2],
    params,
  };
}

export async function verifyCallbackSignature(rawQuery, publicKeyBase64, cryptoProvider = globalThis.crypto) {
  const parsed = parseSignedQuery(rawQuery);
  const publicKey = await cryptoProvider.subtle.importKey(
    'spki',
    base64ToBytes(publicKeyBase64),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  const signature = ecdsaDerToP1363(base64ToBytes(parsed.signature));
  return cryptoProvider.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    signature,
    new TextEncoder().encode(parsed.signedData),
  );
}

export function validateRewardEvent(params, config, nowMs = Date.now()) {
  const transactionId = params.get('transaction_id') || '';
  const adUnit = params.get('ad_unit') || '';
  const rewardItem = params.get('reward_item') || '';
  const rewardAmountText = params.get('reward_amount') || '';
  const userId = params.get('user_id') || '';
  const timestampText = params.get('timestamp') || '';
  const timestampMs = Number(timestampText);
  const rewardAmount = Number(rewardAmountText);
  const unitReward = config.rewardsByAdUnit?.[adUnit];

  if (!TRANSACTION_RE.test(transactionId)) return { ok: false, reason: 'invalid_transaction_id' };
  if (!UUID_RE.test(userId)) return { ok: false, reason: 'missing_or_invalid_user_id' };
  if (!unitReward) {
    return { ok: false, reason: 'ad_unit_not_allowed' };
  }
  if (!isAllowedGameRewardItem(unitReward.item) || rewardItem.toLowerCase() !== unitReward.item.toLowerCase()) {
    return { ok: false, reason: 'reward_item_mismatch_or_cash_like' };
  }
  if (!Number.isSafeInteger(rewardAmount) || rewardAmount < 1 || rewardAmount !== unitReward.amount) {
    return { ok: false, reason: 'reward_amount_mismatch' };
  }
  if (!Number.isSafeInteger(timestampMs) || timestampMs < 1) {
    return { ok: false, reason: 'invalid_timestamp' };
  }
  if (timestampMs > nowMs + 5 * 60 * 1000) return { ok: false, reason: 'timestamp_in_future' };
  if (nowMs - timestampMs > (config.maxEventAgeMs || 7 * 24 * 60 * 60 * 1000)) {
    return { ok: false, reason: 'event_too_old' };
  }
  if (config.expectedCustomData && params.get('custom_data') !== config.expectedCustomData) {
    return { ok: false, reason: 'custom_data_mismatch' };
  }

  return {
    ok: true,
    event: {
      transactionId,
      userId,
      adUnit,
      rewardItem: unitReward.item.toLowerCase(),
      rewardAmount,
      timestampMs,
    },
  };
}

export async function fetchAdMobPublicKeys(fetcher = fetch) {
  const response = await fetcher(ADMOB_PUBLIC_KEYS_URL, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('AdMob key server returned HTTP ' + response.status);
  const body = await response.json();
  if (!Array.isArray(body.keys) || body.keys.length === 0) throw new Error('AdMob key server returned no keys');

  const keys = new Map();
  for (const item of body.keys) {
    if (item && item.keyId !== undefined && typeof item.base64 === 'string') {
      keys.set(String(item.keyId), item.base64);
    }
  }
  if (keys.size === 0) throw new Error('AdMob key response has no usable keys');
  return keys;
}

