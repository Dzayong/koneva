import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import pool from '../shared/database/connection';
import {
  assertCanAddMember, assertSubscriptionActive, createOrder, currentUsage, listPublicPlans,
  requestStudentVerification,
} from './services/billing.service';
import { ServiceError } from './services/service-error';

type Query = (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
const database = pool as unknown as { query: Query; connect: () => Promise<unknown> };
const originalQuery = database.query;
const originalConnect = database.connect;
afterEach(() => { database.query = originalQuery; database.connect = originalConnect; });
const code = (c: string) => (e: unknown) => e instanceof ServiceError && e.code === c;

const day = 86_400_000;

test('a workspace with no subscription row is an older one and may send', async () => {
  const db = { query: async () => ({ rows: [] }) } as never;
  await assert.doesNotReject(() => assertSubscriptionActive(db, 't1'));
});

test('active, trial and in-grace subscriptions may send; expired and suspended ones may not', async () => {
  const at = (status: string, offsetDays: number | null) => ({
    query: async () => ({ rows: [{ status, period_end: offsetDays === null ? null : new Date(Date.now() + offsetDays * day) }] }),
  }) as never;
  await assert.doesNotReject(() => assertSubscriptionActive(at('active', 10), 't1'));
  await assert.doesNotReject(() => assertSubscriptionActive(at('trial', 3), 't1'));
  await assert.doesNotReject(() => assertSubscriptionActive(at('active', -3), 't1'));
  await assert.rejects(() => assertSubscriptionActive(at('trial', -1), 't1'), code('PLAN_INACTIVE'));
  await assert.rejects(() => assertSubscriptionActive(at('active', -30), 't1'), code('PLAN_INACTIVE'));
  await assert.rejects(() => assertSubscriptionActive(at('cancelled', null), 't1'), code('PLAN_INACTIVE'));
});

test('an inactive plan answers 402 with a plain instruction', async () => {
  const db = { query: async () => ({ rows: [{ status: 'active', period_end: new Date(Date.now() - 30 * day) }] }) } as never;
  await assert.rejects(() => assertSubscriptionActive(db, 't1'), (e: unknown) => e instanceof ServiceError && e.status === 402 && /Tagihan/.test(e.message));
});

test('the monthly quota starts again from zero when a new window begins', async () => {
  const updates: unknown[][] = [];
  const db = {
    query: async (text: string, values?: unknown[]) => {
      if (text.includes('FROM tenants')) return { rows: [{ quota_messages: 1000, used_messages: 990, usage_period_start: new Date(Date.now() - 45 * day) }] };
      if (text.includes('FROM subscriptions')) return { rows: [{ period_start: new Date(Date.now() - 45 * day) }] };
      if (text.startsWith('UPDATE tenants')) { updates.push(values ?? []); return { rows: [] }; }
      return { rows: [] };
    },
  } as never;
  const usage = await currentUsage(db, 't1');
  assert.equal(usage.used, 0);
  assert.equal(usage.quota, 1000);
  assert.equal(updates.length, 1);
  assert.ok(usage.resetsAt && usage.resetsAt.getTime() > Date.now());
});

test('within the current window the counter is kept', async () => {
  const start = new Date(Date.now() - 5 * day);
  const db = {
    query: async (text: string) => text.includes('FROM tenants')
      ? { rows: [{ quota_messages: 1000, used_messages: 990, usage_period_start: start }] }
      : { rows: [{ period_start: start }] },
  } as never;
  assert.equal((await currentUsage(db, 't1')).used, 990);
});

test('team size follows the plan, counting pending invitations', async () => {
  database.query = async (text) => text.includes('max_members') ? { rows: [{ max_members: 3 }] } : { rows: [{ n: 3 }] };
  await assert.rejects(() => assertCanAddMember('t1'), code('PLAN_MEMBER_LIMIT'));
  database.query = async (text) => text.includes('max_members') ? { rows: [{ max_members: 3 }] } : { rows: [{ n: 2 }] };
  await assert.doesNotReject(() => assertCanAddMember('t1'));
  database.query = async () => ({ rows: [] });
  await assert.doesNotReject(() => assertCanAddMember('t1'));
});

test('visitors never see a price the operator has not made final', async () => {
  database.query = async () => ({ rows: [
    { id: 'umkm', name: 'UMKM', audience: 'umkm', price_month_idr: 99000, price_year_idr: 990000, max_devices: 3, monthly_messages: 10000, max_members: 3, requires_student_verification: false, price_is_final: false, features: [] },
    { id: 'pelajar', name: 'Pelajar', audience: 'pelajar', price_month_idr: 19000, price_year_idr: 190000, max_devices: 1, monthly_messages: 1000, max_members: 1, requires_student_verification: true, price_is_final: true, features: [] },
  ] });
  const plans = await listPublicPlans();
  assert.equal(plans.find((p) => p.id === 'umkm')?.price_month_idr, null);
  assert.equal(plans.find((p) => p.id === 'pelajar')?.price_month_idr, 19000);
});

// Runs createOrder against a transaction whose statements are answered by `handler`.
function withTransaction(handler: (text: string, values?: unknown[]) => { rows: unknown[] }) {
  database.query = async (text) => text.includes('FROM payg_settings')
    ? { rows: [{ enabled: false }] }
    : { rows: [] };
  const client = { query: async (text: string, values?: unknown[]) => (/^(BEGIN|COMMIT|ROLLBACK)/.test(text)
    ? { rows: [] }
    : text.startsWith('SELECT name,email FROM tenants')
      ? { rows: [{ name: 'Synthetic Workspace', email: 'synthetic@example.test' }] }
      : handler(text, values)), release() {} };
  database.connect = async () => client;
}

const plan = (over: Record<string, unknown> = {}) => ({
  id: 'umkm', name: 'UMKM', audience: 'umkm', price_month_idr: 99000, price_year_idr: 990000, max_devices: 3,
  monthly_messages: 10000, max_members: 3, trial_days: null, requires_student_verification: false, price_is_final: true,
  published: true, sort_order: 2, features: [], quota_headline: null, quota_note: null, ...over,
});

test('PAYG workspaces cannot create legacy package invoices', async () => {
  database.query = async () => ({ rows: [{ enabled: true }] });
  await assert.rejects(() => createOrder('t1', 'umkm', 'monthly'), code('PACKAGES_RETIRED'));
});

test('an order needs a real plan and a final price', async () => {
  withTransaction((text) => text.includes('FROM plans') ? { rows: [] } : { rows: [] });
  await assert.rejects(() => createOrder('t1', 'nope', 'monthly'), code('INVALID_PLAN'));
  withTransaction((text) => text.includes('FROM plans') ? { rows: [plan({ audience: 'internal' })] } : { rows: [] });
  await assert.rejects(() => createOrder('t1', 'internal', 'monthly'), code('INVALID_PLAN'));
  withTransaction((text) => text.includes('FROM plans') ? { rows: [plan({ price_is_final: false })] } : { rows: [] });
  await assert.rejects(() => createOrder('t1', 'umkm', 'monthly'), code('PRICE_NOT_FINAL'));
  withTransaction((text) => text.includes('FROM plans') ? { rows: [plan({ price_month_idr: 0 })] } : { rows: [] });
  await assert.rejects(() => createOrder('t1', 'umkm', 'monthly'), code('PRICE_NOT_SET'));
});

test('the paid Pelajar order can be created before evidence verification', async () => {
  let inserted = false;
  let invoiceValues: unknown[] | undefined;
  withTransaction((text, values) => {
    if (text.includes('FROM plans')) return { rows: [plan({ id: 'pelajar', requires_student_verification: true, price_month_idr: 29000 })] };
    if (text.startsWith('INSERT INTO invoices')) { inserted = true; invoiceValues = values; return { rows: [{ id: 'i1', number: 'INV-1' }] }; }
    return { rows: [] };
  });
  await createOrder('t1', 'pelajar', 'monthly');
  assert.equal(inserted, true);
  assert.deepEqual(invoiceValues?.slice(4), ['Synthetic Workspace', 'synthetic@example.test'], 'invoice captures its billing identity before a later account purge');
});

test('annual checkout is closed for new orders (T1.1): yearly is refused before any query runs', async () => {
  await assert.rejects(() => createOrder('t1', 'umkm', 'yearly'), code('ANNUAL_CHECKOUT_CLOSED'));
});

test('an order voids the previous open invoice and prices at the current catalog rate', async () => {
  const statements: string[] = [];
  let amount: unknown;
  withTransaction((text, values) => {
    statements.push(text);
    if (text.includes('FROM plans')) return { rows: [plan()] };
    if (text.startsWith('SELECT plan_id, price_override_idr')) return { rows: [] }; // no existing subscription: no override
    if (text.startsWith('INSERT INTO invoices')) { amount = values?.[3]; return { rows: [{ id: 'i1', number: 'INV-202609-0001', status: 'unpaid' }] }; }
    return { rows: [] };
  });
  const invoice = await createOrder('t1', 'umkm', 'monthly');
  assert.equal(amount, 99000);
  assert.equal(invoice.number, 'INV-202609-0001');
  assert.ok(statements.findIndex((s) => s.includes("SET status = 'void'")) < statements.findIndex((s) => s.startsWith('INSERT INTO invoices')));
});

test('grandfather: a subscription with an override for the SAME plan is charged the override, not the catalog price', async () => {
  let amount: unknown;
  withTransaction((text, values) => {
    if (text.includes('FROM plans')) return { rows: [plan({ id: 'pelajar', price_month_idr: 29000 })] };
    if (text.startsWith('SELECT plan_id, price_override_idr')) return { rows: [{ plan_id: 'pelajar', price_override_idr: 19000 }] };
    if (text.startsWith('INSERT INTO invoices')) { amount = values?.[3]; return { rows: [{ id: 'i1', number: 'INV-1', status: 'unpaid' }] }; }
    return { rows: [] };
  });
  await createOrder('t1', 'pelajar', 'monthly');
  assert.equal(amount, 19000, 'grandfathered Pelajar renews at the old 19.000, not the new 29.000 catalog price');
});

test('grandfather does not follow a plan change: switching plans pays the catalog price even with a stale override on the row', async () => {
  let amount: unknown;
  withTransaction((text, values) => {
    if (text.includes('FROM plans')) return { rows: [plan({ id: 'asisten', price_month_idr: 59000 })] };
    // The override on file belongs to a DIFFERENT plan (pelajar); it must not leak into an order for 'asisten'.
    if (text.startsWith('SELECT plan_id, price_override_idr')) return { rows: [{ plan_id: 'pelajar', price_override_idr: 19000 }] };
    if (text.startsWith('INSERT INTO invoices')) { amount = values?.[3]; return { rows: [{ id: 'i1', number: 'INV-1', status: 'unpaid' }] }; }
    return { rows: [] };
  });
  await createOrder('t1', 'asisten', 'monthly');
  assert.equal(amount, 59000);
});

test('student verification asks for a school or campus email', async () => {
  await assert.rejects(() => requestStudentVerification('t1', 'me@gmail.com', 'saya mahasiswa'), code('NOT_A_STUDENT_EMAIL'));
  const seen: unknown[][] = [];
  withTransaction((text, v) => {
    if (text.startsWith('SELECT id FROM tenants')) return { rows: [{ id: 't1' }] };
    if (text.startsWith('INSERT INTO student_requests')) { seen.push(v ?? []); return { rows: [{ id: 'student-request-1' }] }; }
    return { rows: [] };
  });
  await assert.doesNotReject(() => requestStudentVerification('t1', 'me@mhs.ui.ac.id', 'x'.repeat(900)));
  assert.equal(seen[0]?.[1], 'me@mhs.ui.ac.id');
  assert.equal((seen[0]?.[2] as string).length, 500);
});

import { activatePaid, createTrial, grantPlan, markInvoicePaid, type PlanRow } from './services/billing.service';

const planRow = (over: Partial<PlanRow> = {}): PlanRow => ({
  id: 'umkm', name: 'UMKM', audience: 'umkm', price_month_idr: 99000, price_year_idr: 990000, max_devices: 3,
  monthly_messages: 10000, max_members: 3, trial_days: null, requires_student_verification: false, price_is_final: true,
  published: true, sort_order: 2, features: [], quota_headline: null, quota_note: null, ...over,
});

function fakeClient(current?: { plan_id: string; period_start: Date; period_end: Date | null }) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  return {
    calls,
    client: {
      query: async (text: string, values: unknown[] = []) => {
        calls.push({ text, values });
        return { rows: text.includes('FROM subscriptions') && current ? [current] : [] };
      },
    } as never,
  };
}

test('paying while still active extends from the current end and keeps the quota', async () => {
  const now = new Date('2026-10-01T00:00:00Z');
  const { client, calls } = fakeClient({ plan_id: 'umkm', period_start: new Date('2026-09-20T00:00:00Z'), period_end: new Date('2026-10-20T00:00:00Z') });
  const period = await activatePaid(client, 't1', planRow(), 'monthly', now);
  assert.equal(period.period_start.toISOString(), '2026-09-20T00:00:00.000Z');
  assert.equal(period.period_end.toISOString(), '2026-11-20T00:00:00.000Z');
  const tenantUpdate = calls.find((c) => c.text.startsWith('UPDATE tenants'))!;
  assert.ok(!tenantUpdate.text.includes('used_messages = 0'), 'an early renewal must not hand out a fresh quota');
});

test('a lapsed subscription or a different plan starts a fresh period with a fresh quota', async () => {
  const now = new Date('2026-10-01T00:00:00Z');
  for (const current of [
    { plan_id: 'umkm', period_start: new Date('2026-08-01T00:00:00Z'), period_end: new Date('2026-09-01T00:00:00Z') },
    { plan_id: 'pelajar', period_start: new Date('2026-09-20T00:00:00Z'), period_end: new Date('2026-10-20T00:00:00Z') },
    undefined,
  ]) {
    const { client, calls } = fakeClient(current);
    const period = await activatePaid(client, 't1', planRow(), 'yearly', now);
    assert.equal(period.period_start.toISOString(), now.toISOString());
    assert.equal(period.period_end.toISOString(), '2027-10-01T00:00:00.000Z');
    assert.ok(calls.find((c) => c.text.startsWith('UPDATE tenants'))!.text.includes('used_messages = 0'));
  }
});

test('the limits on the workspace come from the plan that was paid for', async () => {
  const { client, calls } = fakeClient();
  await activatePaid(client, 't1', planRow({ max_devices: 3, monthly_messages: 10000 }), 'monthly');
  const values = calls.find((c) => c.text.startsWith('UPDATE tenants'))!.values;
  assert.deepEqual(values.slice(0, 3), ['t1', 3, 10000]);
});

test('signing up creates a trial from the trial plan and applies its limits', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const client = {
    query: async (text: string, values: unknown[] = []) => {
      calls.push({ text, values });
      return { rows: text.includes('FROM plans') ? [planRow({ id: 'trial', audience: 'trial', max_devices: 1, monthly_messages: 200, trial_days: 14 })] : [] };
    },
  } as never;
  const now = new Date('2026-10-01T00:00:00Z');
  await createTrial(client, 't1', now);
  const insert = calls.find((c) => c.text.startsWith('INSERT INTO subscriptions'))!;
  assert.equal((insert.values[2] as Date).toISOString(), '2026-10-15T00:00:00.000Z');
  assert.deepEqual(calls.find((c) => c.text.startsWith('UPDATE tenants'))!.values.slice(0, 3), ['t1', 1, 200]);
});

test('marking an invoice paid activates the plan even while student proof is pending; repeat payment is refused', async () => {
  const seen: string[] = [];
  const build = (over: { invoiceStatus?: string; plan?: Partial<PlanRow>; verified?: boolean }) => withTransaction((text) => {
    seen.push(text);
    if (text.includes('FROM invoices')) return { rows: [{ id: 'i1', tenant_id: 't1', number: 'INV-1', amount_idr: 99000, plan_id: 'umkm', cycle: 'monthly', status: over.invoiceStatus ?? 'unpaid' }] };
    if (text.includes('FROM plans')) return { rows: [planRow(over.plan)] };
    if (text.includes('student_verified_at')) return { rows: [{ student_verified_at: over.verified ? new Date() : null }] };
    return { rows: [] };
  });

  build({});
  const result = await markInvoicePaid('i1', { method: 'transfer', reference: 'BCA-123' });
  assert.equal(result.plan, 'umkm');
  assert.ok(seen.some((s) => s.startsWith("UPDATE invoices SET status = 'paid'")));
  assert.ok(seen.some((s) => s.startsWith('INSERT INTO subscriptions')));

  build({ invoiceStatus: 'paid' });
  await assert.rejects(() => markInvoicePaid('i1', { method: 'transfer' }), code('INVOICE_NOT_PAYABLE'));
  build({ plan: { requires_student_verification: true }, verified: false });
  await assert.doesNotReject(() => markInvoicePaid('i1', { method: 'transfer' }));
  build({ plan: { requires_student_verification: true }, verified: true });
  await assert.doesNotReject(() => markInvoicePaid('i1', { method: 'transfer' }));
});

test('a manual grant records a zero-amount paid invoice so the history stays complete', async () => {
  const inserted: string[] = [];
  withTransaction((text) => {
    if (text.includes('FROM plans')) return { rows: [planRow()] };
    if (text.startsWith('SELECT 1 FROM tenants')) return { rows: [{ '?column?': 1 }] };
    if (text.startsWith('INSERT INTO invoices')) inserted.push(text);
    return { rows: [] };
  });
  await grantPlan('t1', 'umkm', 'monthly', 'beta tester');
  assert.equal(inserted.length, 1);
  assert.ok(inserted[0]!.includes("'grant'"));
});
