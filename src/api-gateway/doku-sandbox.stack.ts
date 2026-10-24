import assert from 'node:assert/strict';
import { test } from 'node:test';
import pool from '../shared/database/connection';
import { createOrder, getLatestUnpaidInvoice } from './services/billing.service';
import { handleDokuNotification } from './services/doku.service';
import { computeDokuSignature } from './services/doku-signature';
import { ServiceError } from './services/service-error';

/**
 * STACK-level synthetic proof for the DOKU webhook path (docs/DOKU_INTEGRATION_SPEC.md), run only via
 * scripts/test-doku-sandbox.sh against a fresh disposable Postgres with migrations 001-035 applied.
 * DOKU_SHARED_KEY here is `synthetic-doku-shared-key-not-real` (scripts/test-doku-sandbox.sh) — never a
 * real DOKU credential, since none exists yet. No network call to any DOKU host is made by this test;
 * it calls handleDokuNotification() directly, the exact function POST /billing/doku/notify calls.
 */

const SHARED_KEY = 'synthetic-doku-shared-key-not-real';
const CLIENT_ID = 'MCH-SYNTHETIC-TEST';
const REQUEST_TARGET = '/billing/doku/notify';
const ASISTEN_MONTHLY_IDR = 59000;

async function seedTenant(): Promise<string> {
  const row = (await pool.query<{ id: string }>(
    `INSERT INTO tenants(name,email,api_key,status) VALUES ($1,$2,NULL,'active') RETURNING id`,
    [`doku-sandbox-${Date.now()}-${Math.random().toString(36).slice(2)}`, `doku-sandbox-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`],
  )).rows[0]!;
  return row.id;
}

function freshTimestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function sign(requestId: string, timestamp: string, rawBody: string) {
  return computeDokuSignature({ clientId: CLIENT_ID, requestId, requestTimestamp: timestamp, requestTarget: REQUEST_TARGET, rawBody }, SHARED_KEY);
}

function notificationBody(invoiceNumber: string, status: string, overrides: { amount?: number | string; currency?: string | null } = {}) {
  return JSON.stringify({
    order: {
      invoice_number: invoiceNumber,
      amount: overrides.amount ?? ASISTEN_MONTHLY_IDR,
      ...(overrides.currency === null ? {} : { currency: overrides.currency ?? 'IDR' }),
    },
    transaction: { status, date: new Date().toISOString() },
  });
}

test('SUCCESS notification with a valid signature confirms the invoice and activates the workspace, exactly once', async () => {
  const tenantId = await seedTenant();
  const invoice = await createOrder(tenantId, 'asisten', 'monthly');
  const rawBody = notificationBody(invoice.number, 'SUCCESS');
  const requestId = `req-${invoice.number}`;
  const timestamp = freshTimestamp();
  const signature = sign(requestId, timestamp, rawBody);

  const result = await handleDokuNotification(rawBody, { clientId: CLIENT_ID, requestId, requestTimestamp: timestamp, signature }, REQUEST_TARGET);
  assert.deepEqual(result, { applied: true, reason: 'activated' });

  const paid = (await pool.query<{ status: string }>('SELECT status FROM invoices WHERE id=$1', [invoice.id])).rows[0]!;
  assert.equal(paid.status, 'paid');
  const sub = (await pool.query<{ status: string; plan_id: string }>('SELECT status,plan_id FROM subscriptions WHERE tenant_id=$1', [tenantId])).rows[0]!;
  assert.equal(sub.status, 'active');
  assert.equal(sub.plan_id, 'asisten');

  // Replay: same Request-Id, already recorded -> never re-applied, invoice stays paid (not double-charged/activated).
  const replay = await handleDokuNotification(rawBody, { clientId: CLIENT_ID, requestId, requestTimestamp: timestamp, signature }, REQUEST_TARGET);
  assert.deepEqual(replay, { applied: false, reason: 'replay' });
});

test('a second SUCCESS notification under a different Request-Id for an already-paid invoice is refused by billing, not re-applied', async () => {
  const tenantId = await seedTenant();
  const invoice = await createOrder(tenantId, 'asisten', 'monthly');
  const rawBody = notificationBody(invoice.number, 'SUCCESS');
  const ts = freshTimestamp();
  const req1 = `req-a-${invoice.number}`;
  await handleDokuNotification(rawBody, { clientId: CLIENT_ID, requestId: req1, requestTimestamp: ts, signature: sign(req1, ts, rawBody) }, REQUEST_TARGET);

  const req2 = `req-b-${invoice.number}`;
  const second = await handleDokuNotification(rawBody, { clientId: CLIENT_ID, requestId: req2, requestTimestamp: ts, signature: sign(req2, ts, rawBody) }, REQUEST_TARGET);
  assert.deepEqual(second, { applied: false, reason: 'already_paid' });
});

test('a tampered body fails signature verification and is rejected before touching billing', async () => {
  const tenantId = await seedTenant();
  const invoice = await createOrder(tenantId, 'asisten', 'monthly');
  const rawBody = notificationBody(invoice.number, 'SUCCESS');
  const requestId = `req-tamper-${invoice.number}`;
  const timestamp = freshTimestamp();
  const signature = sign(requestId, timestamp, rawBody); // signed over the ORIGINAL body
  const tamperedBody = notificationBody(invoice.number, 'SUCCESS', { amount: 1 });

  await assert.rejects(
    handleDokuNotification(tamperedBody, { clientId: CLIENT_ID, requestId, requestTimestamp: timestamp, signature }, REQUEST_TARGET),
    (e: unknown) => e instanceof ServiceError && e.status === 401 && e.code === 'INVALID_SIGNATURE',
  );
  const stillUnpaid = await getLatestUnpaidInvoice(tenantId);
  assert.equal(stillUnpaid?.id, invoice.id, 'rejected notification must not touch the invoice at all');
});

test('a non-SUCCESS status (e.g. PENDING) is recorded but never activates the workspace', async () => {
  const tenantId = await seedTenant();
  const invoice = await createOrder(tenantId, 'asisten', 'monthly');
  const rawBody = notificationBody(invoice.number, 'PENDING');
  const requestId = `req-pending-${invoice.number}`;
  const timestamp = freshTimestamp();
  const signature = sign(requestId, timestamp, rawBody);

  const result = await handleDokuNotification(rawBody, { clientId: CLIENT_ID, requestId, requestTimestamp: timestamp, signature }, REQUEST_TARGET);
  assert.deepEqual(result, { applied: false, reason: 'status_PENDING' });
  const stillUnpaid = await getLatestUnpaidInvoice(tenantId);
  assert.equal(stillUnpaid?.id, invoice.id);
});

test('a notification for an invoice_number that does not exist is recorded but safely ignored', async () => {
  const rawBody = notificationBody('INV-DOES-NOT-EXIST-0001', 'SUCCESS');
  const requestId = 'req-unknown-invoice';
  const timestamp = freshTimestamp();
  const signature = sign(requestId, timestamp, rawBody);
  const result = await handleDokuNotification(rawBody, { clientId: CLIENT_ID, requestId, requestTimestamp: timestamp, signature }, REQUEST_TARGET);
  assert.deepEqual(result, { applied: false, reason: 'invoice_not_found' });
});

test('an amount that does not match the stored invoice is rejected without activating anything', async () => {
  const tenantId = await seedTenant();
  const invoice = await createOrder(tenantId, 'asisten', 'monthly');
  const rawBody = notificationBody(invoice.number, 'SUCCESS', { amount: ASISTEN_MONTHLY_IDR + 1 });
  const requestId = `req-amount-${invoice.number}`;
  const timestamp = freshTimestamp();
  const signature = sign(requestId, timestamp, rawBody);

  const result = await handleDokuNotification(rawBody, { clientId: CLIENT_ID, requestId, requestTimestamp: timestamp, signature }, REQUEST_TARGET);
  assert.deepEqual(result, { applied: false, reason: 'amount_mismatch' });
  const stillUnpaid = await getLatestUnpaidInvoice(tenantId);
  assert.equal(stillUnpaid?.id, invoice.id);
});

test('a currency other than IDR is rejected without activating anything', async () => {
  const tenantId = await seedTenant();
  const invoice = await createOrder(tenantId, 'asisten', 'monthly');
  const rawBody = notificationBody(invoice.number, 'SUCCESS', { currency: 'USD' });
  const requestId = `req-currency-${invoice.number}`;
  const timestamp = freshTimestamp();
  const signature = sign(requestId, timestamp, rawBody);

  const result = await handleDokuNotification(rawBody, { clientId: CLIENT_ID, requestId, requestTimestamp: timestamp, signature }, REQUEST_TARGET);
  assert.deepEqual(result, { applied: false, reason: 'currency_mismatch' });
  const stillUnpaid = await getLatestUnpaidInvoice(tenantId);
  assert.equal(stillUnpaid?.id, invoice.id);
});

test('a verified wallet top-up accepts DOKU Non-SNAP callbacks with omitted currency and string amount', async () => {
  const tenantId = await seedTenant();
  const invoiceNumber = `TOP-TEST-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await pool.query('INSERT INTO wallet_topups(tenant_id,invoice_number,amount_idr) VALUES($1,$2,50000)', [tenantId, invoiceNumber]);
  const rawBody = notificationBody(invoiceNumber, 'SUCCESS', { amount: '50000', currency: null });
  const requestId = `req-wallet-${invoiceNumber}`;
  const timestamp = freshTimestamp();

  const result = await handleDokuNotification(rawBody, {
    clientId: CLIENT_ID, requestId, requestTimestamp: timestamp, signature: sign(requestId, timestamp, rawBody),
  }, REQUEST_TARGET);
  assert.deepEqual(result, { applied: true, reason: 'wallet_topped_up' });
  const paid = (await pool.query<{ status: string }>(
    'SELECT status FROM wallet_topups WHERE invoice_number=$1', [invoiceNumber],
  )).rows[0]!;
  const ledger = (await pool.query<{ amount_idr: number; event_type: string }>(
    'SELECT amount_idr,event_type FROM wallet_ledger WHERE tenant_id=$1 AND invoice_number=$2', [tenantId, invoiceNumber],
  )).rows[0]!;
  assert.equal(paid.status, 'paid');
  assert.equal(Number(ledger.amount_idr), 50000);
  assert.equal(ledger.event_type, 'topup');
});

test('a Request-Timestamp older than the allowed window is rejected even with a mathematically valid signature', async () => {
  const tenantId = await seedTenant();
  const invoice = await createOrder(tenantId, 'asisten', 'monthly');
  const rawBody = notificationBody(invoice.number, 'SUCCESS');
  const requestId = `req-stale-${invoice.number}`;
  const staleTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'); // 10 minutes old
  const signature = sign(requestId, staleTimestamp, rawBody); // correctly signed FOR that old timestamp

  await assert.rejects(
    handleDokuNotification(rawBody, { clientId: CLIENT_ID, requestId, requestTimestamp: staleTimestamp, signature }, REQUEST_TARGET),
    (e: unknown) => e instanceof ServiceError && e.status === 401 && e.code === 'STALE_TIMESTAMP',
  );
  const stillUnpaid = await getLatestUnpaidInvoice(tenantId);
  assert.equal(stillUnpaid?.id, invoice.id);
});

test('a failure partway through activation rolls back entirely (including the idempotency row); retrying the same Request-Id after the obstruction is cleared actually activates — never silently reported as an already-handled replay', async () => {
  const tenantId = await seedTenant();
  const invoice = await createOrder(tenantId, 'asisten', 'monthly');
  const rawBody = notificationBody(invoice.number, 'SUCCESS');
  const requestId = `req-conflict-${invoice.number}`;
  const timestamp = freshTimestamp();
  const signature = sign(requestId, timestamp, rawBody);

  // Engineer a transient DB-level failure: markInvoicePaidWithClient's UPDATE would set
  // (method='doku', reference=requestId) on this invoice, but another PAID invoice already holds
  // that exact (method, reference) pair, so the partial unique index (invoices_paid_reference_unique)
  // rejects it — a genuine, unexpected failure partway through the transaction, not a clean ServiceError.
  const decoyTenantId = await seedTenant();
  const decoyInvoice = await createOrder(decoyTenantId, 'asisten', 'monthly');
  await pool.query(`UPDATE invoices SET status='paid', paid_at=now(), method='doku', reference=$2 WHERE id=$1`, [decoyInvoice.id, requestId]);

  await assert.rejects(handleDokuNotification(rawBody, { clientId: CLIENT_ID, requestId, requestTimestamp: timestamp, signature }, REQUEST_TARGET));

  // Clean rollback: no idempotency row at all, and the real invoice is still untouched.
  const eventRow = (await pool.query('SELECT 1 FROM doku_notification_events WHERE request_id=$1', [requestId])).rows[0];
  assert.equal(eventRow, undefined, 'a failed attempt must leave no trace, so a retry starts fresh rather than being told "replay"');
  const stillUnpaid = await getLatestUnpaidInvoice(tenantId);
  assert.equal(stillUnpaid?.id, invoice.id);

  // Clear the obstruction (as if the transient condition had passed) and retry with the SAME Request-Id.
  await pool.query(`UPDATE invoices SET reference=NULL WHERE id=$1`, [decoyInvoice.id]);
  const retry = await handleDokuNotification(rawBody, { clientId: CLIENT_ID, requestId, requestTimestamp: timestamp, signature }, REQUEST_TARGET);
  assert.deepEqual(retry, { applied: true, reason: 'activated' }, 'retry must actually activate, not report a false replay');
  const paid = (await pool.query<{ status: string }>('SELECT status FROM invoices WHERE id=$1', [invoice.id])).rows[0]!;
  assert.equal(paid.status, 'paid');
});
