import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeDuitkuCallbackSignature, computeDuitkuRequestSignature, verifyDuitkuCallbackSignature } from './duitku-signature';

test('Duitku create-invoice signature follows HMAC-SHA256(merchantCode + timestamp, apiKey)', () => {
  assert.equal(
    computeDuitkuRequestSignature('D123', '1773728479616', 'sandbox-key'),
    '54ce1adc57552b338b892fd894a8a1db7a683d14e927d94a5562f30c4c9b9e08',
  );
});

test('Duitku callback signature is exact and verified with a timing-safe comparison', () => {
  const signature = computeDuitkuCallbackSignature('D123', '50000', 'TOP-202610-0001', 'sandbox-key');
  assert.equal(verifyDuitkuCallbackSignature('D123', '50000', 'TOP-202610-0001', 'sandbox-key', signature), true);
  assert.equal(verifyDuitkuCallbackSignature('D123', '50001', 'TOP-202610-0001', 'sandbox-key', signature), false);
  assert.equal(verifyDuitkuCallbackSignature('D123', '50000', 'TOP-202610-0001', 'sandbox-key', 'not-hex'), false);
});
