import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  base64ToBytes,
  bytesToBase64Url,
  ecdsaDerToP1363,
  parseSignedQuery,
  validateRewardEvent,
  verifyCallbackSignature,
} from '../supabase/functions/_shared/admob-ssv.mjs';

function p1363ToDer(raw) {
  const half = raw.length / 2;
  const values = [raw.slice(0, half), raw.slice(half)].map((value) => {
    let first = 0;
    while (first < value.length - 1 && value[first] === 0) first += 1;
    let integer = value.slice(first);
    if (integer[0] & 0x80) integer = Uint8Array.from([0, ...integer]);
    return Uint8Array.from([0x02, integer.length, ...integer]);
  });
  const body = Uint8Array.from([...values[0], ...values[1]]);
  return Uint8Array.from([0x30, body.length, ...body]);
}

function callbackPayload(overrides = {}) {
  const now = Date.now();
  return {
    ad_network: '5450213213286189855',
    ad_unit: 'ca-app-pub-test/1234567890',
    reward_amount: '1',
    reward_item: 'game_points',
    timestamp: String(now),
    transaction_id: '18fa792de1bca816048293fc71035638',
    user_id: '00000000-0000-4000-8000-000000000001',
    ...overrides,
  };
}

function signedQuery(payload, signature, keyId = '12345') {
  const body = new URLSearchParams(payload).toString();
  return body + '&signature=' + bytesToBase64Url(signature) + '&key_id=' + keyId;
}

test('parses the signed query without changing its original bytes', () => {
  const query = 'ad_unit=unit%2Fone&reward_amount=1&reward_item=game_points&timestamp=1700000000000&transaction_id=18fa792de1bca816048293fc71035638&user_id=00000000-0000-4000-8000-000000000001&signature=abc&key_id=2';
  const parsed = parseSignedQuery(query);
  assert.equal(parsed.signedData, query.slice(0, query.indexOf('&signature=')));
  assert.equal(parsed.params.get('ad_unit'), 'unit/one');
  assert.equal(parsed.keyId, '2');
});

test('rejects missing and repeated signature parameters', () => {
  assert.throws(() => parseSignedQuery('ad_unit=x&key_id=1'), /signature/);
  assert.throws(
    () => parseSignedQuery('ad_unit=x&signature=a&key_id=1&signature=b&key_id=1'),
    /repeated signature/,
  );
});

test('parses Google callbacks with optional user_id but never credits them without a mapped user', () => {
  const payload = callbackPayload();
  delete payload.user_id;
  const parsed = parseSignedQuery(new URLSearchParams(payload).toString() + '&signature=abc&key_id=2');
  const validation = validateRewardEvent(parsed.params, {
    allowedAdUnits: [payload.ad_unit],
    rewardItem: payload.reward_item,
    rewardAmount: 1,
  });
  assert.equal(validation.reason, 'missing_or_invalid_user_id');
});

test('converts DER ECDSA signatures to the WebCrypto raw format', () => {
  const der = Uint8Array.from([
    0x30, 0x06,
    0x02, 0x01, 0x01,
    0x02, 0x01, 0x02,
  ]);
  const raw = ecdsaDerToP1363(der, 4);
  assert.deepEqual([...raw], [0, 0, 0, 1, 0, 0, 0, 2]);
  assert.throws(() => ecdsaDerToP1363(Uint8Array.from([0x30, 0x01, 0x00])), /DER integer/);
});

test('validates a signed ECDSA callback and detects signed-data tampering', async () => {
  const pair = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const publicKey = await webcrypto.subtle.exportKey('spki', pair.publicKey);
  const payload = callbackPayload();
  const body = new URLSearchParams(payload).toString();
  const rawSignature = new Uint8Array(await webcrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    pair.privateKey,
    new TextEncoder().encode(body),
  ));
  const derSignature = p1363ToDer(rawSignature);
  const query = signedQuery(payload, derSignature);
  const encodedKey = Buffer.from(publicKey).toString('base64');

  assert.equal(await verifyCallbackSignature(query, encodedKey, webcrypto), true);
  assert.equal(await verifyCallbackSignature(query.replace('reward_amount=1', 'reward_amount=2'), encodedKey, webcrypto), false);
  assert.ok(base64ToBytes(encodedKey).length > 0);
});

test('accepts only fresh, mapped, configured, non-cash game rewards', () => {
  const payload = callbackPayload();
  const params = new URLSearchParams(payload);
  const config = {
    allowedAdUnits: ['ca-app-pub-test/1234567890'],
    rewardItem: 'game_points',
    rewardAmount: 1,
    maxEventAgeMs: 60_000,
  };
  assert.equal(validateRewardEvent(params, config).ok, true);
  assert.equal(validateRewardEvent(params, { ...config, allowedAdUnits: [] }).reason, 'ad_unit_not_allowed');
  assert.equal(validateRewardEvent(params, { ...config, rewardItem: 'cash' }).reason, 'reward_item_mismatch_or_cash_like');
  assert.equal(validateRewardEvent(params, { ...config, rewardAmount: 500 }).reason, 'reward_amount_mismatch');
  assert.equal(validateRewardEvent(new URLSearchParams({ ...payload, user_id: 'not-a-uuid' }), config).reason, 'missing_or_invalid_user_id');
  assert.equal(
    validateRewardEvent(new URLSearchParams({ ...payload, timestamp: String(Date.now() - 120_000) }), config).reason,
    'event_too_old',
  );
});

