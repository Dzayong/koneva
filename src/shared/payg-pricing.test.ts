import assert from 'node:assert/strict';
import test from 'node:test';
import { paygPricingTier } from './payg-pricing';

test('PAYG pricing changes exactly at cumulative paid-usage thresholds', () => {
  assert.deepEqual(paygPricingTier(0).prices, { api: 15, auto_reply: 20, ai_reply: 50 });
  assert.equal(paygPricingTier(499_999).code, 'starter');
  assert.deepEqual(paygPricingTier(500_000).prices, { api: 14, auto_reply: 19, ai_reply: 48 });
  assert.equal(paygPricingTier(1_299_999).code, 'growth');
  assert.deepEqual(paygPricingTier(1_300_000).prices, { api: 13, auto_reply: 18, ai_reply: 46 });
  assert.equal(paygPricingTier(2_499_999).code, 'scale');
  assert.deepEqual(paygPricingTier(2_500_000).prices, { api: 12, auto_reply: 17, ai_reply: 44 });
  assert.equal(paygPricingTier(99_000_000).code, 'max');
});

test('PAYG pricing rejects invalid cumulative usage', () => {
  assert.throws(() => paygPricingTier(-1));
  assert.throws(() => paygPricingTier(1.5));
});
