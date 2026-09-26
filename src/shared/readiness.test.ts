import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeReadiness, hasRecipientOptedOut, type QueryFn, type ReadinessInputs } from './readiness';

function inputs(overrides: Partial<ReadinessInputs> = {}): ReadinessInputs {
  return {
    status: 'online', ageDays: 10, warmupCompleted: true,
    maturedSent: 50, maturedDelivered: 50,
    uniqueRecipients: 40, engagedRecipients: 20, unsolicitedRecipients: 4, optOuts: 0,
    ...overrides,
  };
}
const factor = (report: ReturnType<typeof computeReadiness>, id: string) => report.factors.find((f) => f.id === id)!;

test('a brand-new online number is mid-scale, unproven, never a free 25', () => {
  const report = computeReadiness(inputs({
    ageDays: 0, warmupCompleted: false, maturedSent: 0, maturedDelivered: 0,
    uniqueRecipients: 0, engagedRecipients: 0, unsolicitedRecipients: 0,
  }));
  assert.equal(report.score, 15 + 0 + 13 + 10 + 10);
  assert.equal(report.confidence, 'low');
  assert.equal(report.tier, 'fair');
  assert.equal(factor(report, 'delivery').proven, false);
});

test('a mature, consented, engaged number scores 100', () => {
  const report = computeReadiness(inputs());
  assert.equal(report.score, 100);
  assert.equal(report.tier, 'excellent');
  assert.equal(report.confidence, 'high');
});

test('maturity follows the anti-ban warm-up stage boundaries', () => {
  const at = (ageDays: number) => factor(computeReadiness(inputs({ ageDays, warmupCompleted: false })), 'maturity').score;
  assert.deepEqual([at(0), at(1), at(2), at(3), at(4), at(6), at(7)], [0, 0, 6, 6, 12, 12, 20]);
});

test('delivery tiers use only sends older than 24h and need a minimum sample', () => {
  const at = (delivered: number) => factor(computeReadiness(inputs({ maturedSent: 100, maturedDelivered: delivered })), 'delivery');
  assert.equal(at(97).score, 25);
  assert.equal(at(93).score, 18);
  assert.equal(at(85).score, 10);
  assert.equal(at(84).score, 0);
  assert.equal(at(84).status, 'danger');
  assert.equal(factor(computeReadiness(inputs({ maturedSent: 4, maturedDelivered: 0 })), 'delivery').proven, false);
});

test('engagement tiers', () => {
  const at = (engaged: number) => factor(computeReadiness(inputs({ uniqueRecipients: 100, engagedRecipients: engaged })), 'engagement').score;
  assert.deepEqual([at(25), at(15), at(8), at(3), at(2)], [20, 14, 8, 4, 0]);
});

test('cold outreach lowers the consent factor', () => {
  const at = (unsolicited: number) => factor(computeReadiness(inputs({ uniqueRecipients: 100, unsolicitedRecipients: unsolicited })), 'consent').score;
  assert.deepEqual([at(20), at(50), at(80), at(81)], [20, 12, 5, 0]);
});

test('opt-out requests above 2% cost 10 points and flag danger', () => {
  const clean = factor(computeReadiness(inputs({ uniqueRecipients: 100, unsolicitedRecipients: 10, optOuts: 2 })), 'consent');
  const bad = factor(computeReadiness(inputs({ uniqueRecipients: 100, unsolicitedRecipients: 10, optOuts: 3 })), 'consent');
  assert.equal(clean.score, 20);
  assert.equal(bad.score, 10);
  assert.equal(bad.status, 'danger');
});

test('banned numbers always score 0; paused and offline score lower on stability', () => {
  assert.equal(computeReadiness(inputs({ status: 'banned' })).score, 0);
  const stability = (status: string) => factor(computeReadiness(inputs({ status })), 'stability').score;
  assert.deepEqual([stability('online'), stability('offline'), stability('paused'), stability('error')], [15, 8, 3, 0]);
});

test('recommendations point at the weakest proven factors', () => {
  const report = computeReadiness(inputs({ maturedDelivered: 40, engagedRecipients: 0, unsolicitedRecipients: 39, optOuts: 3 }));
  const text = report.recommendations.join(' | ');
  assert.match(text, /Delivery rendah/);
  assert.match(text, /Balasan rendah/);
  assert.match(text, /opt-in/);
  assert.match(text, /3 penerima yang meminta berhenti/);
});

test('hasRecipientOptedOut normalises the number and reads inbound history', async () => {
  let params: unknown[] = [];
  const queryFn: QueryFn = async (_sql, p) => { params = p ?? []; return { rows: [{ '?column?': 1 }] }; };
  assert.equal(await hasRecipientOptedOut('dev-1', '+62 858-6203-3524', queryFn), true);
  assert.equal(params[1], '6285862033524');
  assert.equal(await hasRecipientOptedOut('dev-1', '', async () => ({ rows: [{}] })), false);
  assert.equal(await hasRecipientOptedOut('dev-1', '628', async () => ({ rows: [] })), false);
});
