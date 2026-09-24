import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeHealthScore, type HealthScoreInputs } from './health-score';

function baseInputs(overrides: Partial<HealthScoreInputs> = {}): HealthScoreInputs {
  return {
    deviceAgeDays: 0,
    warmupCompleted: false,
    totalSent: 0,
    delivered: 0,
    replied: 0,
    blocked: 0,
    reported: 0,
    ...overrides,
  };
}

// blocked/reported counts placed inside their "gap" bands (block 0.5%-2%,
// report 0.1%-1%) so they contribute 0 and don't mask the category under test.
const NEUTRAL_BLOCKED_PER_100 = 1;
const NEUTRAL_REPORTED_PER_100 = 1;

test('new device with no history scores 0', () => {
  assert.equal(computeHealthScore(baseInputs()), 0);
});

test('age tiers are non-cumulative', () => {
  assert.equal(computeHealthScore(baseInputs({ deviceAgeDays: 5 })), 0);
  assert.equal(computeHealthScore(baseInputs({ deviceAgeDays: 10 })), 10);
  assert.equal(computeHealthScore(baseInputs({ deviceAgeDays: 31 })), 20);
});

test('warmup completed adds 20 points', () => {
  assert.equal(computeHealthScore(baseInputs({ warmupCompleted: true })), 20);
});

test('delivery rate tiers', () => {
  const neutral = { totalSent: 100, blocked: NEUTRAL_BLOCKED_PER_100, reported: NEUTRAL_REPORTED_PER_100 };
  const high = computeHealthScore(baseInputs({ ...neutral, delivered: 96 }));
  const mid = computeHealthScore(baseInputs({ ...neutral, delivered: 91 }));
  const low = computeHealthScore(baseInputs({ ...neutral, delivered: 50 }));
  assert.equal(high, 20);
  assert.equal(mid, 10);
  assert.equal(low, 0);
});

test('reply rate tiers', () => {
  const neutral = { totalSent: 100, blocked: NEUTRAL_BLOCKED_PER_100, reported: NEUTRAL_REPORTED_PER_100 };
  assert.equal(computeHealthScore(baseInputs({ ...neutral, replied: 31 })), 15);
  assert.equal(computeHealthScore(baseInputs({ ...neutral, replied: 16 })), 8);
  assert.equal(computeHealthScore(baseInputs({ ...neutral, replied: 5 })), 0);
});

test('block rate rewards low and penalizes high', () => {
  const low = computeHealthScore(baseInputs({ totalSent: 1000, blocked: 4, reported: 5 }));
  const high = computeHealthScore(baseInputs({ totalSent: 100, blocked: 3, reported: NEUTRAL_REPORTED_PER_100 }));
  assert.equal(low, 15);
  assert.equal(high, 0); // -20 clamped to the 0 floor
});

test('report rate rewards low and penalizes high', () => {
  const low = computeHealthScore(baseInputs({ totalSent: 1000, reported: 0, blocked: 15 }));
  const high = computeHealthScore(baseInputs({ totalSent: 100, reported: 2, blocked: NEUTRAL_BLOCKED_PER_100 }));
  assert.equal(low, 10);
  assert.equal(high, 0); // -30 clamped to the 0 floor
});

test('score is clamped between 0 and 100', () => {
  const perfect = computeHealthScore(
    baseInputs({
      deviceAgeDays: 40,
      warmupCompleted: true,
      totalSent: 1000,
      delivered: 999,
      replied: 400,
      blocked: 0,
      reported: 0,
    }),
  );
  assert.equal(perfect, 100);

  const worst = computeHealthScore(
    baseInputs({
      totalSent: 100,
      blocked: 10,
      reported: 5,
    }),
  );
  assert.equal(worst, 0);
});
