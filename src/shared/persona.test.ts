import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  activeWindow, dailyFactor, evaluateFatigue, generatePersona, getBurstState, isWithinPersonaWindow,
  msUntilNextDayWindow, msUntilWindowOpens, type QueryFn,
} from './persona';

const seeds = Array.from({ length: 200 }, (_, i) => `seed-${i}`);

test('a persona is deterministic per seed and stays inside human ranges', () => {
  assert.deepEqual(generatePersona('abc'), generatePersona('abc'));
  for (const seed of seeds) {
    const p = generatePersona(seed);
    assert.ok(p.wakeHour >= 6 && p.wakeHour <= 8.5, `wake ${p.wakeHour}`);
    assert.ok(p.sleepHour >= 21 && p.sleepHour <= 23.5, `sleep ${p.sleepHour}`);
    assert.ok(p.delayMinMs >= 8_000 && p.delayMinMs <= 20_000);
    assert.ok(p.delayMaxMs > p.delayMinMs && p.delayMaxMs <= 20_000 + 55_000);
    assert.ok(p.burstSize >= 6 && p.burstSize <= 15);
    assert.ok(p.restMinMs >= 4 * 60_000 && p.restMaxMs > p.restMinMs);
    assert.ok(p.typingMsPerChar >= 45 && p.typingMsPerChar <= 80);
  }
});

test('different numbers get different habits', () => {
  const distinctBursts = new Set(seeds.map((s) => generatePersona(s).burstSize));
  const distinctWake = new Set(seeds.map((s) => generatePersona(s).wakeHour));
  assert.ok(distinctBursts.size >= 8);
  assert.ok(distinctWake.size >= 8);
});

test('the active window drifts a little per day but is stable within a day', () => {
  const p = generatePersona('window');
  const noon = new Date('2026-09-24T05:00:00Z');
  const later = new Date('2026-09-24T09:00:00Z');
  assert.deepEqual(activeWindow(p, noon), activeWindow(p, later));
  for (let d = 1; d <= 28; d += 1) {
    const w = activeWindow(p, new Date(`2026-09-${String(d).padStart(2, '0')}T05:00:00Z`));
    assert.ok(Math.abs(w.start - p.wakeHour) <= 1 / 3 + 1e-9);
    assert.ok(Math.abs(w.end - p.sleepHour) <= 1 / 3 + 1e-9);
  }
});

test('window is open at midday, closed at night, and reopens at wake-up time', () => {
  const p = generatePersona('night');
  const noon = new Date('2026-09-24T05:00:00Z');       // 12:00 WIB
  const threeAm = new Date('2026-09-23T20:00:00Z');    // 03:00 WIB
  assert.equal(isWithinPersonaWindow(p, noon), true);
  assert.equal(isWithinPersonaWindow(p, threeAm), false);
  assert.equal(msUntilWindowOpens(p, noon), 0);
  const hours = msUntilWindowOpens(p, threeAm) / 3_600_000;
  assert.ok(Math.abs(hours - (p.wakeHour - 3)) <= 1 / 3 + 0.02, `hours ${hours}`);
  const nextDay = msUntilNextDayWindow(p, noon) / 3_600_000;
  assert.ok(Math.abs(nextDay - (24 - 12 + p.wakeHour)) < 0.01);
});

test('daily volume factor only dips, never exceeds the cap, and differs between days', () => {
  const p = generatePersona('daily');
  const factors = Array.from({ length: 30 }, (_, i) => dailyFactor(p, new Date(Date.UTC(2026, 8, i + 1, 5))));
  assert.ok(factors.every((f) => f >= 0.8 && f <= 1));
  assert.ok(new Set(factors.map((f) => f.toFixed(4))).size > 20);
});

test('fatigue: rests after a burst, then recovers, and the decision is repeatable', () => {
  const p = generatePersona('tired');
  const start = new Date('2026-09-24T05:00:00Z');
  const lastAt = new Date(start.getTime() + 8 * 60_000);
  const fresh = evaluateFatigue(p, { burstCount: 1, burstStartAt: start, lastAt }, lastAt);
  assert.equal(fresh.resting, false);

  const state = { burstCount: 100, burstStartAt: start, lastAt };
  const justAfter = new Date(lastAt.getTime() + 30_000);
  const a = evaluateFatigue(p, state, justAfter);
  const b = evaluateFatigue(p, state, justAfter);
  assert.equal(a.resting, true);
  assert.deepEqual(a, b);
  const restMs = a.restEndsAt!.getTime() - lastAt.getTime();
  assert.ok(restMs >= p.restMinMs && restMs <= p.restMaxMs);
  assert.equal(evaluateFatigue(p, state, new Date(a.restEndsAt!.getTime() + 1)).resting, false);
});

test('burst limit varies from burst to burst around the persona size', () => {
  const p = generatePersona('varied');
  const limits = new Set(Array.from({ length: 40 }, (_, i) =>
    evaluateFatigue(p, { burstCount: 0, burstStartAt: new Date(Date.UTC(2026, 8, 1, i)), lastAt: new Date() }, new Date()).burstLimit));
  assert.ok(limits.size >= 3);
  for (const l of limits) assert.ok(l >= 3 && l <= Math.round(p.burstSize * 1.3));
});

test('getBurstState maps the database row', async () => {
  const queryFn: QueryFn = async () => ({ rows: [{ burst_start: '2026-09-24T05:00:00Z', burst_count: 4, last_at: '2026-09-24T05:03:00Z' }] });
  const state = await getBurstState('dev-1', queryFn);
  assert.equal(state.burstCount, 4);
  assert.equal(state.lastAt?.toISOString(), '2026-09-24T05:03:00.000Z');
  const empty = await getBurstState('dev-1', async () => ({ rows: [{}] }));
  assert.deepEqual(empty, { burstCount: 0, burstStartAt: null, lastAt: null });
});

test('always_on keeps the window open at any hour; delay mode follows min/max', async () => {
  const { delayMode } = await import('./persona');
  const p = { ...generatePersona('always'), alwaysOn: true };
  assert.equal(isWithinPersonaWindow(p, new Date('2026-09-23T20:00:00Z')), true); // 03:00 WIB
  assert.equal(msUntilWindowOpens(p, new Date('2026-09-23T20:00:00Z')), 0);
  assert.equal(delayMode({ ...p, delayMinMs: 5000, delayMaxMs: 5000 }), 'flat');
  assert.equal(delayMode({ ...p, delayMinMs: 5000, delayMaxMs: 100000 }), 'random');
});
