import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeDokuSignature, dokuDigest, verifyDokuSignature } from './doku-signature';

/**
 * Pure math only: synthetic client id/secret, never a real DOKU credential (none exists yet — see
 * docs/DOKU_INTEGRATION_SPEC.md). Confirms the HMAC algorithm itself, not DOKU's live behavior.
 */
const SYNTHETIC_SECRET = 'synthetic-test-shared-key-not-real';

test('computeDokuSignature produces the documented HMACSHA256=<base64> format', () => {
  const signature = computeDokuSignature({
    clientId: 'MCH-TEST-0001', requestId: 'req-1', requestTimestamp: '2026-10-04T03:24:23Z',
    requestTarget: '/checkout/v1/payment', rawBody: '{"order":{"amount":29000}}',
  }, SYNTHETIC_SECRET);
  assert.match(signature, /^HMACSHA256=[A-Za-z0-9+/]+=*$/);
});

test('a bodyless request (GET) omits the Digest line and still signs deterministically', () => {
  const input = { clientId: 'MCH-TEST-0001', requestId: 'req-2', requestTimestamp: '2026-10-04T03:24:23Z', requestTarget: '/orders/v1/status/INV-1' };
  const a = computeDokuSignature(input, SYNTHETIC_SECRET);
  const b = computeDokuSignature(input, SYNTHETIC_SECRET);
  assert.equal(a, b, 'same input, same key: identical signature every time');
});

test('verifyDokuSignature accepts a signature it just computed, for a request and a notification shape alike', () => {
  const input = {
    clientId: 'MCH-TEST-0001', requestId: 'req-3', requestTimestamp: '2026-10-04T03:24:23Z',
    requestTarget: '/billing/doku/notify', rawBody: '{"transaction":{"status":"SUCCESS"}}',
  };
  const signature = computeDokuSignature(input, SYNTHETIC_SECRET);
  assert.equal(verifyDokuSignature(input, SYNTHETIC_SECRET, signature), true);
});

test('verification fails if a single byte of the body changes (tamper detection)', () => {
  const input = { clientId: 'MCH-TEST-0001', requestId: 'req-4', requestTimestamp: '2026-10-04T03:24:23Z', requestTarget: '/billing/doku/notify', rawBody: '{"transaction":{"status":"SUCCESS"}}' };
  const signature = computeDokuSignature(input, SYNTHETIC_SECRET);
  const tampered = { ...input, rawBody: '{"transaction":{"status":"FAILED"}}' };
  assert.equal(verifyDokuSignature(tampered, SYNTHETIC_SECRET, signature), false);
});

test('verification fails for a replayed signature against a different Request-Id', () => {
  const original = { clientId: 'MCH-TEST-0001', requestId: 'req-5', requestTimestamp: '2026-10-04T03:24:23Z', requestTarget: '/billing/doku/notify', rawBody: '{}' };
  const signature = computeDokuSignature(original, SYNTHETIC_SECRET);
  const replay = { ...original, requestId: 'req-6' };
  assert.equal(verifyDokuSignature(replay, SYNTHETIC_SECRET, signature), false);
});

test('verification fails against a stale/mismatched Request-Timestamp', () => {
  const original = { clientId: 'MCH-TEST-0001', requestId: 'req-7', requestTimestamp: '2026-10-04T03:24:23Z', requestTarget: '/billing/doku/notify', rawBody: '{}' };
  const signature = computeDokuSignature(original, SYNTHETIC_SECRET);
  const stale = { ...original, requestTimestamp: '2026-10-04T03:25:00Z' };
  assert.equal(verifyDokuSignature(stale, SYNTHETIC_SECRET, signature), false);
});

test('verification fails with the wrong shared key', () => {
  const input = { clientId: 'MCH-TEST-0001', requestId: 'req-8', requestTimestamp: '2026-10-04T03:24:23Z', requestTarget: '/billing/doku/notify', rawBody: '{}' };
  const signature = computeDokuSignature(input, SYNTHETIC_SECRET);
  assert.equal(verifyDokuSignature(input, 'a-different-synthetic-key', signature), false);
});

test('dokuDigest is base64(sha256(body)), stable for the same body', () => {
  const digest = dokuDigest('{"a":1}');
  assert.match(digest, /^[A-Za-z0-9+/]+=*$/);
  assert.equal(digest, dokuDigest('{"a":1}'));
  assert.notEqual(digest, dokuDigest('{"a":2}'));
});
