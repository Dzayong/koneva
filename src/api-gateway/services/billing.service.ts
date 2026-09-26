import type { PoolClient } from 'pg';
import pool, { transaction } from '../../shared/database/connection';
import {
  GRACE_DAYS, addMonths, canSend, effectiveStatus, looksLikeStudentEmail, priceFor, usageWindow,
  type BillingCycle, type SubscriptionStatus,
} from '../../shared/billing';
import { ServiceError } from './service-error';

type Queryable = Pick<PoolClient, 'query'> | typeof pool;

export interface PlanRow {
  id: string; name: string; audience: string; price_month_idr: number; price_year_idr: number;
  max_devices: number; monthly_messages: number; max_members: number; trial_days: number | null;
  requires_student_verification: boolean; price_is_final: boolean; published: boolean; sort_order: number; features: string[];
}

const PLAN_COLUMNS = `id, name, audience, price_month_idr, price_year_idr, max_devices, monthly_messages, max_members,
  trial_days, requires_student_verification, price_is_final, published, sort_order, features`;

const INACTIVE_MESSAGE: Partial<Record<SubscriptionStatus, string>> = {
  expired: 'Masa uji coba sudah berakhir. Pilih paket di halaman Tagihan untuk melanjutkan mengirim.',
  suspended: 'Langganan ditangguhkan karena belum diperpanjang. Perpanjang di halaman Tagihan; nomor dan data Anda tetap aman.',
  cancelled: 'Langganan sudah dihentikan. Hubungi penyedia layanan untuk mengaktifkannya kembali.',
};

// ---- Limits enforced elsewhere ------------------------------------------------

/** Sending, adding numbers and similar actions need a live subscription. No row means an older workspace: allowed. */
export async function assertSubscriptionActive(db: Queryable, tenantId: string): Promise<void> {
  const row = (await db.query<{ status?: SubscriptionStatus; period_end?: Date | null }>(
    'SELECT status, period_end FROM subscriptions WHERE tenant_id = $1',
    [tenantId],
  )).rows[0];
  if (!row?.status) return;
  const status = effectiveStatus({ status: row.status, period_end: row.period_end ?? null });
  if (!canSend(status)) {
    throw new ServiceError(402, 'PLAN_INACTIVE', INACTIVE_MESSAGE[status] ?? 'Langganan tidak aktif.');
  }
}

/**
 * Applies the monthly quota window inside the caller's transaction: when a new window has begun the counter
 * starts again from zero. Returns how much is used now and when the quota resets.
 */
export async function currentUsage(client: Queryable, tenantId: string, now: Date = new Date()): Promise<{
  used: number; quota: number; resetsAt: Date | null;
}> {
  const tenant = (await client.query<{ quota_messages: number; used_messages: number; usage_period_start: Date | null }>(
    'SELECT quota_messages, used_messages, usage_period_start FROM tenants WHERE id = $1 FOR UPDATE', [tenantId],
  )).rows[0];
  if (!tenant) return { used: 0, quota: 0, resetsAt: null };
  const sub = (await client.query<{ period_start?: Date }>('SELECT period_start FROM subscriptions WHERE tenant_id = $1', [tenantId])).rows[0];
  if (!sub?.period_start) return { used: tenant.used_messages, quota: tenant.quota_messages, resetsAt: null };

  const window = usageWindow(new Date(sub.period_start), now);
  if (!tenant.usage_period_start || new Date(tenant.usage_period_start).getTime() < window.start.getTime()) {
    await client.query('UPDATE tenants SET used_messages = 0, usage_period_start = $2 WHERE id = $1', [tenantId, window.start]);
    return { used: 0, quota: tenant.quota_messages, resetsAt: window.end };
  }
  return { used: tenant.used_messages, quota: tenant.quota_messages, resetsAt: window.end };
}

export async function assertCanAddMember(tenantId: string): Promise<void> {
  const plan = (await pool.query<{ max_members?: number }>(
    'SELECT p.max_members FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.tenant_id = $1', [tenantId],
  )).rows[0];
  if (plan?.max_members === undefined) return;
  const taken = (await pool.query<{ n: number }>(
    `SELECT ((SELECT COUNT(*) FROM memberships WHERE tenant_id = $1)
           + (SELECT COUNT(*) FROM invitations WHERE tenant_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()))::int AS n`,
    [tenantId],
  )).rows[0]?.n ?? 0;
  if (taken >= plan.max_members) {
    throw new ServiceError(402, 'PLAN_MEMBER_LIMIT', `Paket Anda maksimal ${plan.max_members} anggota tim. Naikkan paket di halaman Tagihan untuk menambah.`);
  }
}

// ---- Plans, trial, activation -------------------------------------------------

export async function listPlans(db: Queryable, opts: { publishedOnly: boolean }): Promise<PlanRow[]> {
  return (await db.query<PlanRow>(
    `SELECT ${PLAN_COLUMNS} FROM plans ${opts.publishedOnly ? 'WHERE published = true' : ''} ORDER BY sort_order, id`,
  )).rows;
}

/** What visitors see: prices stay hidden until the operator marks them final. */
export async function listPublicPlans() {
  const plans = await listPlans(pool, { publishedOnly: true });
  return plans.map((p) => ({
    id: p.id, name: p.name, audience: p.audience, features: p.features,
    max_devices: p.max_devices, monthly_messages: p.monthly_messages, max_members: p.max_members,
    requires_student_verification: p.requires_student_verification,
    price_month_idr: p.price_is_final ? p.price_month_idr : null,
    price_year_idr: p.price_is_final ? p.price_year_idr : null,
    price_is_final: p.price_is_final,
  }));
}

export async function createTrial(client: Queryable, tenantId: string, now: Date = new Date()): Promise<void> {
  const plan = (await client.query<PlanRow>(`SELECT ${PLAN_COLUMNS} FROM plans WHERE id = 'trial'`)).rows[0];
  if (!plan) return;
  const end = new Date(now.getTime() + (plan.trial_days ?? 14) * 86_400_000);
  await client.query(
    `INSERT INTO subscriptions (tenant_id, plan_id, status, period_start, period_end) VALUES ($1, 'trial', 'trial', $2, $3)
     ON CONFLICT (tenant_id) DO NOTHING`,
    [tenantId, now, end],
  );
  await client.query(
    'UPDATE tenants SET max_devices = $2, quota_messages = $3, used_messages = 0, usage_period_start = $4 WHERE id = $1',
    [tenantId, plan.max_devices, plan.monthly_messages, now],
  );
}

/**
 * Starts or extends a paid period. Paying early adds time on top of the current end and keeps the current
 * quota; a new plan or a lapsed subscription starts a fresh period with a fresh quota.
 */
export async function activatePaid(client: Queryable, tenantId: string, plan: PlanRow, cycle: BillingCycle, now: Date = new Date()): Promise<{ period_start: Date; period_end: Date }> {
  const months = cycle === 'yearly' ? 12 : 1;
  const current = (await client.query<{ plan_id: string; period_start: Date; period_end: Date | null }>(
    'SELECT plan_id, period_start, period_end FROM subscriptions WHERE tenant_id = $1', [tenantId],
  )).rows[0];
  const extend = current && current.plan_id === plan.id && current.period_end && new Date(current.period_end).getTime() > now.getTime();
  const start = extend ? new Date(current.period_start) : now;
  const end = addMonths(extend ? new Date(current!.period_end!) : now, months);

  await client.query(
    `INSERT INTO subscriptions (tenant_id, plan_id, status, cycle, period_start, period_end, updated_at)
     VALUES ($1, $2, 'active', $3, $4, $5, now())
     ON CONFLICT (tenant_id) DO UPDATE SET plan_id = $2, status = 'active', cycle = $3, period_start = $4, period_end = $5, updated_at = now()`,
    [tenantId, plan.id, cycle, start, end],
  );
  await client.query(
    `UPDATE tenants SET max_devices = $2, quota_messages = $3${extend ? '' : ', used_messages = 0, usage_period_start = $4'} WHERE id = $1`,
    extend ? [tenantId, plan.max_devices, plan.monthly_messages] : [tenantId, plan.max_devices, plan.monthly_messages, now],
  );
  return { period_start: start, period_end: end };
}

// ---- Student verification -----------------------------------------------------

export async function requestStudentVerification(tenantId: string, requesterEmail: string, note: string): Promise<void> {
  if (!looksLikeStudentEmail(requesterEmail)) {
    throw new ServiceError(400, 'NOT_A_STUDENT_EMAIL', 'Paket Pelajar butuh email kampus atau sekolah (mis. .ac.id atau .sch.id).');
  }
  await pool.query('UPDATE tenants SET student_request_at = now(), student_note = $2 WHERE id = $1', [tenantId, note.slice(0, 500)]);
}

export async function setStudentVerified(tenantId: string, approved: boolean, note: string | undefined): Promise<void> {
  const result = await pool.query(
    'UPDATE tenants SET student_verified_at = $2, student_note = COALESCE($3, student_note) WHERE id = $1 RETURNING id',
    [tenantId, approved ? new Date() : null, note ?? null],
  );
  if (result.rows.length === 0) throw new ServiceError(404, 'TENANT_NOT_FOUND', 'Workspace not found');
}

// ---- Orders and manual payment ------------------------------------------------

export interface InvoiceRow {
  id: string; number: string; plan_id: string; cycle: BillingCycle; amount_idr: number; status: 'unpaid' | 'paid' | 'void';
  due_at: Date; paid_at: Date | null; method: string | null; reference: string | null; created_at: Date;
}

export async function createOrder(tenantId: string, planId: string, cycle: BillingCycle): Promise<InvoiceRow> {
  return transaction(async (client) => {
    const plan = (await client.query<PlanRow>(`SELECT ${PLAN_COLUMNS} FROM plans WHERE id = $1 AND published = true`, [planId])).rows[0];
    if (!plan || plan.audience === 'trial' || plan.audience === 'internal') throw new ServiceError(400, 'INVALID_PLAN', 'Paket tidak tersedia.');
    if (!plan.price_is_final) throw new ServiceError(409, 'PRICE_NOT_FINAL', 'Harga paket ini belum diumumkan. Hubungi penyedia layanan untuk mengaktifkan.');
    const amount = priceFor(plan, cycle);
    if (amount <= 0) throw new ServiceError(409, 'PRICE_NOT_SET', 'Harga paket belum diatur.');
    if (plan.requires_student_verification) {
      const tenant = (await client.query<{ student_verified_at: Date | null }>('SELECT student_verified_at FROM tenants WHERE id = $1', [tenantId])).rows[0];
      if (!tenant?.student_verified_at) throw new ServiceError(409, 'STUDENT_NOT_VERIFIED', 'Paket Pelajar butuh verifikasi status pelajar terlebih dulu.');
    }
    // Only one open invoice at a time, so a customer is never unsure which one to pay.
    await client.query(`UPDATE invoices SET status = 'void' WHERE tenant_id = $1 AND status = 'unpaid'`, [tenantId]);
    return (await client.query<InvoiceRow>(
      `INSERT INTO invoices (tenant_id, number, plan_id, cycle, amount_idr, due_at)
       VALUES ($1, 'INV-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('invoice_number_seq')::text, 4, '0'), $2, $3, $4, now() + interval '7 days')
       RETURNING id, number, plan_id, cycle, amount_idr, status, due_at, paid_at, method, reference, created_at`,
      [tenantId, plan.id, cycle, amount],
    )).rows[0]!;
  });
}

export async function markInvoicePaid(invoiceId: string, input: { method: string; reference?: string | undefined; note?: string | undefined }) {
  return transaction(async (client) => {
    const invoice = (await client.query<InvoiceRow & { tenant_id: string }>(
      'SELECT id, tenant_id, number, plan_id, cycle, amount_idr, status, due_at, paid_at, method, reference, created_at FROM invoices WHERE id = $1 FOR UPDATE',
      [invoiceId],
    )).rows[0];
    if (!invoice) throw new ServiceError(404, 'INVOICE_NOT_FOUND', 'Invoice not found');
    if (invoice.status !== 'unpaid') throw new ServiceError(409, 'INVOICE_NOT_PAYABLE', `Invoice is already ${invoice.status}`);
    const plan = (await client.query<PlanRow>(`SELECT ${PLAN_COLUMNS} FROM plans WHERE id = $1`, [invoice.plan_id])).rows[0]!;
    if (plan.requires_student_verification) {
      const tenant = (await client.query<{ student_verified_at: Date | null }>('SELECT student_verified_at FROM tenants WHERE id = $1', [invoice.tenant_id])).rows[0];
      if (!tenant?.student_verified_at) throw new ServiceError(409, 'STUDENT_NOT_VERIFIED', 'Verify the student status before activating this plan');
    }
    await client.query(
      `UPDATE invoices SET status = 'paid', paid_at = now(), method = $2, reference = $3, note = $4 WHERE id = $1`,
      [invoiceId, input.method, input.reference ?? null, input.note ?? null],
    );
    const period = await activatePaid(client, invoice.tenant_id, plan, invoice.cycle);
    return { tenant_id: invoice.tenant_id, invoice: invoice.number, plan: plan.id, ...period };
  });
}

export async function voidInvoice(invoiceId: string): Promise<void> {
  const result = await pool.query(`UPDATE invoices SET status = 'void' WHERE id = $1 AND status = 'unpaid' RETURNING id`, [invoiceId]);
  if (result.rows.length === 0) throw new ServiceError(404, 'INVOICE_NOT_FOUND', 'No unpaid invoice with that id');
}

/** Operator grant without an invoice (beta users, gifts, corrections). */
export async function grantPlan(tenantId: string, planId: string, cycle: BillingCycle, note: string): Promise<{ period_start: Date; period_end: Date }> {
  return transaction(async (client) => {
    const plan = (await client.query<PlanRow>(`SELECT ${PLAN_COLUMNS} FROM plans WHERE id = $1`, [planId])).rows[0];
    if (!plan) throw new ServiceError(404, 'PLAN_NOT_FOUND', 'Plan not found');
    const tenant = await client.query('SELECT 1 FROM tenants WHERE id = $1', [tenantId]);
    if (tenant.rows.length === 0) throw new ServiceError(404, 'TENANT_NOT_FOUND', 'Workspace not found');
    const period = await activatePaid(client, tenantId, plan, cycle);
    await client.query(
      `INSERT INTO invoices (tenant_id, number, plan_id, cycle, amount_idr, status, due_at, paid_at, method, note)
       VALUES ($1, 'INV-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('invoice_number_seq')::text, 4, '0'), $2, $3, 0, 'paid', now(), now(), 'grant', $4)`,
      [tenantId, plan.id, cycle, note],
    );
    return period;
  });
}

// ---- What a workspace sees ----------------------------------------------------

export async function getBillingState(tenantId: string) {
  const sub = (await pool.query<{ plan_id: string; status: SubscriptionStatus; cycle: BillingCycle | null; period_start: Date; period_end: Date | null }>(
    'SELECT plan_id, status, cycle, period_start, period_end FROM subscriptions WHERE tenant_id = $1', [tenantId],
  )).rows[0];
  const tenant = (await pool.query<{ quota_messages: number; used_messages: number; max_devices: number; usage_period_start: Date | null; student_verified_at: Date | null; student_request_at: Date | null; email: string | null }>(
    'SELECT quota_messages, used_messages, max_devices, usage_period_start, student_verified_at, student_request_at, email FROM tenants WHERE id = $1', [tenantId],
  )).rows[0];
  const plan = sub ? (await pool.query<PlanRow>(`SELECT ${PLAN_COLUMNS} FROM plans WHERE id = $1`, [sub.plan_id])).rows[0] : undefined;
  const now = new Date();
  const status = sub ? effectiveStatus({ status: sub.status, period_end: sub.period_end }, now) : 'active';
  const window = sub ? usageWindow(new Date(sub.period_start), now) : null;
  // A window that has begun but not been written yet still counts from zero.
  const rolled = window && (!tenant?.usage_period_start || new Date(tenant.usage_period_start).getTime() < window.start.getTime());
  const counts = (await pool.query<{ devices: number; members: number }>(
    `SELECT (SELECT COUNT(*) FROM devices WHERE tenant_id = $1)::int AS devices,
            (SELECT COUNT(*) FROM memberships WHERE tenant_id = $1)::int AS members`, [tenantId],
  )).rows[0];
  const invoices = (await pool.query<InvoiceRow>(
    `SELECT id, number, plan_id, cycle, amount_idr, status, due_at, paid_at, method, reference, created_at
     FROM invoices WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 12`, [tenantId],
  )).rows;
  const orderable = (await listPlans(pool, { publishedOnly: true })).map((p) => ({
    ...p, price_month_idr: p.price_is_final ? p.price_month_idr : null, price_year_idr: p.price_is_final ? p.price_year_idr : null,
  }));
  const daysLeft = sub?.period_end ? Math.ceil((new Date(sub.period_end).getTime() - now.getTime()) / 86_400_000) : null;

  return {
    subscription: sub ? {
      plan_id: sub.plan_id, plan_name: plan?.name ?? sub.plan_id, status, cycle: sub.cycle,
      period_start: sub.period_start, period_end: sub.period_end, days_left: daysLeft, grace_days: GRACE_DAYS,
    } : null,
    usage: {
      messages_used: rolled ? 0 : (tenant?.used_messages ?? 0), messages_limit: tenant?.quota_messages ?? 0,
      resets_at: window?.end ?? null,
      devices_used: counts?.devices ?? 0, devices_limit: tenant?.max_devices ?? 0,
      members_used: counts?.members ?? 0, members_limit: plan?.max_members ?? null,
    },
    student: { verified: Boolean(tenant?.student_verified_at), requested: Boolean(tenant?.student_request_at) },
    plans: orderable.filter((p) => p.audience !== 'trial' && p.audience !== 'internal'),
    invoices,
  };
}

/** One cheap query for the banner every member sees; the full picture is owner-only. */
export async function getSubscriptionSummary(tenantId: string, now: Date = new Date()) {
  const row = (await pool.query<{ plan_id: string; plan_name: string; status: SubscriptionStatus; period_end: Date | null }>(
    `SELECT s.plan_id, p.name AS plan_name, s.status, s.period_end
     FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.tenant_id = $1`, [tenantId],
  )).rows[0];
  if (!row) return null;
  const status = effectiveStatus({ status: row.status, period_end: row.period_end }, now);
  return {
    plan_id: row.plan_id, plan_name: row.plan_name, status,
    can_send: canSend(status),
    days_left: row.period_end ? Math.ceil((new Date(row.period_end).getTime() - now.getTime()) / 86_400_000) : null,
    period_end: row.period_end,
  };
}

// ---- Operator views and the sweeper ------------------------------------------

export async function listSubscriptions(filter: { status?: string | undefined; q?: string | undefined }) {
  return (await pool.query(
    `SELECT t.id AS tenant_id, t.name, t.email, s.plan_id, s.status, s.cycle, s.period_start, s.period_end,
            t.used_messages, t.quota_messages, t.max_devices, t.student_verified_at, t.student_request_at, t.student_note
     FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id
     WHERE ($1::text IS NULL OR s.status = $1) AND ($2::text IS NULL OR t.name ILIKE '%' || $2 || '%' OR t.email ILIKE '%' || $2 || '%')
     ORDER BY s.period_end NULLS LAST LIMIT 200`,
    [filter.status ?? null, filter.q ?? null],
  )).rows;
}

export async function listAllInvoices(status: string | undefined) {
  return (await pool.query(
    `SELECT i.id, i.number, t.name AS workspace, t.email, i.plan_id, i.cycle, i.amount_idr, i.status, i.due_at, i.paid_at, i.method, i.reference
     FROM invoices i JOIN tenants t ON t.id = i.tenant_id WHERE ($1::text IS NULL OR i.status = $1)
     ORDER BY i.created_at DESC LIMIT 200`, [status ?? null],
  )).rows;
}

type PlanPatch = { [K in 'name' | 'price_month_idr' | 'price_year_idr' | 'max_devices' | 'monthly_messages' | 'max_members' | 'price_is_final' | 'published']?: PlanRow[K] | undefined };

export async function updatePlan(id: string, patch: PlanPatch) {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (entries.length === 0) throw new ServiceError(400, 'EMPTY_PATCH', 'Nothing to update');
  const sets = entries.map(([k], i) => `${k} = $${i + 2}`).join(', ');
  const result = await pool.query(`UPDATE plans SET ${sets}, updated_at = now() WHERE id = $1 RETURNING ${PLAN_COLUMNS}`, [id, ...entries.map(([, v]) => v)]);
  if (result.rows.length === 0) throw new ServiceError(404, 'PLAN_NOT_FOUND', 'Plan not found');
  return result.rows[0];
}

/** Writes the lapsed states so operators can filter on them; enforcement never depends on this having run. */
export async function sweepSubscriptions(): Promise<{ expired: number; past_due: number; suspended: number }> {
  const expired = await pool.query(`UPDATE subscriptions SET status = 'expired', updated_at = now() WHERE status = 'trial' AND period_end < now() RETURNING tenant_id`);
  const pastDue = await pool.query(
    `UPDATE subscriptions SET status = 'past_due', updated_at = now()
     WHERE status = 'active' AND period_end < now() AND period_end + make_interval(days => $1::int) >= now() RETURNING tenant_id`, [GRACE_DAYS]);
  const suspended = await pool.query(
    `UPDATE subscriptions SET status = 'suspended', updated_at = now()
     WHERE status IN ('active', 'past_due') AND period_end + make_interval(days => $1::int) < now() RETURNING tenant_id`, [GRACE_DAYS]);
  return { expired: expired.rows.length, past_due: pastDue.rows.length, suspended: suspended.rows.length };
}
