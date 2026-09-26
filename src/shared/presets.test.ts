import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PRESETS, PRESET_IDS, isPresetId, presetValuesFor } from './presets';

const seeds = Array.from({ length: 300 }, (_, i) => `seed-${i}`);

test('every preset stays inside the database limits for any number', () => {
  for (const id of PRESET_IDS) {
    for (const seed of seeds) {
      const v = presetValuesFor(id, seed);
      assert.ok(v.wakeHour >= 0 && v.wakeHour < v.sleepHour && v.sleepHour <= 24, `${id} hours`);
      assert.ok(v.delayMinMs >= 1_000 && v.delayMaxMs >= v.delayMinMs, `${id} delay`);
      assert.ok(v.restMinMs >= 60_000 && v.restMaxMs >= v.restMinMs, `${id} rest`);
      assert.ok(v.burstSize >= 2 && v.burstSize <= 60, `${id} burst`);
      assert.ok(v.typingMsPerChar >= 20 && v.typingMsPerChar <= 200, `${id} typing`);
    }
  }
});

test('a preset gives a number stable values, but different numbers get different ones', () => {
  assert.deepEqual(presetValuesFor('customer_service', 'a'), presetValuesFor('customer_service', 'a'));
  // One parameter is rounded to a coarse step, so judge variety by the whole combination.
  const distinct = new Set(seeds.map((s) => JSON.stringify(presetValuesFor('customer_service', s))));
  assert.ok(distinct.size >= 200, `only ${distinct.size} distinct rhythms out of ${seeds.length}`);
});

test('variations stay close to the preset so its meaning is kept', () => {
  for (const id of PRESET_IDS) {
    const base = PRESETS[id];
    for (const seed of seeds) {
      const v = presetValuesFor(id, seed);
      assert.ok(Math.abs(v.delayMinMs - base.delay_min_ms) <= base.delay_min_ms * 0.13 + 100, `${id} dmin ${v.delayMinMs}`);
      assert.ok(Math.abs(v.burstSize - base.burst_size) <= 2, `${id} burst`);
      assert.equal(v.alwaysOn, base.always_on);
    }
  }
});

test('preset meaning: service and notifications are 24h, marketing keeps working hours and slow pacing', () => {
  assert.equal(PRESETS.customer_service.always_on, true);
  assert.equal(PRESETS.notifications.always_on, true);
  assert.equal(PRESETS.careful_marketing.always_on, false);
  assert.ok(PRESETS.notifications.delay_max_ms < PRESETS.customer_service.delay_min_ms + 1);
  assert.ok(PRESETS.careful_marketing.delay_min_ms > PRESETS.customer_service.delay_min_ms);
  assert.ok(PRESETS.careful_marketing.burst_size < PRESETS.customer_service.burst_size);
});

test('preset ids are validated', () => {
  assert.equal(isPresetId('notifications'), true);
  assert.equal(isPresetId('custom'), false);
});
