import assert from 'node:assert/strict';
import { test } from 'node:test';
import pool from '../shared/database/connection';
import config from '../shared/config';
import { createDuitkuCheckout, handleDuitkuCallback } from './services/duitku.service';
import { computeDuitkuCallbackSignature, computeDuitkuRequestSignature } from './services/duitku-signature';
import { ServiceError } from './services/service-error';

const MERCHANT = 'MCH-DUITKU-SYNTHETIC';
const API_KEY = 'synthetic-merchant-key-not-real';

test('Create Invoice sends the signed sandbox request and only returns Duitku hosted HTTPS payment URLs', async () => {
  const originalFetch = globalThis.fetch;
  let captured: { url: string; init: RequestInit } | undefined;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(input), init: init ?? {} };
    return new Response(JSON.stringify({
      merchantCode: MERCHANT, reference: 'SYNTHETIC-REFERENCE',
      paymentUrl: 'https://app-sandbox.duitku.com/redirect_checkout?reference=SYNTHETIC-REFERENCE', statusCode: '00',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const checkout = await createDuitkuCheckout('TOP-TEST-REQUEST-0001', 50000, { id: 'tenant-id', name: 'KONEVA Sandbox', email: 'test@example.test' });
    assert.equal(checkout.payment_url, 'https://app-sandbox.duitku.com/redirect_checkout?reference=SYNTHETIC-REFERENCE');
    assert.equal(checkout.reference, 'SYNTHETIC-REFERENCE');
    assert.equal(captured?.url, `${config.duitku.baseUrl}/api/merchant/createInvoice`);
    const headers = new Headers(captured?.init.headers);
    const timestamp = headers.get('x-duitku-timestamp')!;
    assert.equal(headers.get('x-duitku-merchantcode'), MERCHANT);
    assert.equal(headers.get('x-duitku-signature'), computeDuitkuRequestSignature(MERCHANT, timestamp, API_KEY));
    const body = JSON.parse(String(captured?.init.body)) as Record<string, unknown>;
    assert.equal(body.merchantOrderId, 'TOP-TEST-REQUEST-0001');
    assert.equal(body.paymentAmount, 50000);
    assert.equal(body.callbackUrl, 'https://duitku-callback.example.test/billing/duitku/notify');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

async function seedTenant(): Promise<string> {
  return (await pool.query<{ id: string }>(
    `INSERT INTO tenants(name,email,api_key,status) VALUES ($1,$2,NULL,'active') RETURNING id`,
    [`duitku-test-${Date.now()}-${Math.random().toString(36).slice(2)}`, `duitku-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`],
  )).rows[0]!.id;
}

async function seedTopup(provider = 'duitku', status = 'unpaid', amount = 50000) {
  const tenantId = await seedTenant();
  const invoiceNumber = `TOP-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  await pool.query(
    `INSERT INTO wallet_topups(tenant_id,invoice_number,amount_idr,payment_provider,status)
     VALUES($1,$2,$3,$4,$5)`, [tenantId, invoiceNumber, amount, provider, status],
  );
  return { tenantId, invoiceNumber };
}

function callback(merchantOrderId: string, overrides: Partial<{ amount: string; resultCode: string; reference: string }> = {}) {
  const amount = overrides.amount ?? '50000';
  const resultCode = overrides.resultCode ?? '00';
  const reference = overrides.reference ?? `DUITKU-${merchantOrderId}`;
  return {
    merchantCode: MERCHANT,
    amount,
    merchantOrderId,
    resultCode,
    reference,
    signature: computeDuitkuCallbackSignature(MERCHANT, amount, merchantOrderId, API_KEY),
  };
}

test('signed success credits exactly once and a repeated callback is idempotent', async () => {
  const { tenantId, invoiceNumber } = await seedTopup();
  const first = await handleDuitkuCallback(callback(invoiceNumber));
  const replay = await handleDuitkuCallback(callback(invoiceNumber));
  assert.deepEqual(first, { applied: true, reason: 'wallet_topped_up' });
  assert.deepEqual(replay, { applied: false, reason: 'replay' });
  const balance = (await pool.query<{ available_idr: string }>('SELECT available_idr FROM wallet_accounts WHERE tenant_id=$1', [tenantId])).rows[0]!;
  const ledger = await pool.query('SELECT id FROM wallet_ledger WHERE tenant_id=$1 AND idempotency_key=$2', [tenantId, `wallet-topup:${invoiceNumber}`]);
  assert.equal(Number(balance.available_idr), 50000);
  assert.equal(ledger.rowCount, 1);
});

test('invalid signature is rejected before a callback event or wallet credit is written', async () => {
  const { tenantId, invoiceNumber } = await seedTopup();
  const bad = callback(invoiceNumber);
  bad.signature = 'a'.repeat(64);
  await assert.rejects(handleDuitkuCallback(bad), (error: unknown) => error instanceof ServiceError && error.code === 'INVALID_SIGNATURE');
  const events = await pool.query('SELECT 1 FROM duitku_callback_events WHERE merchant_order_id=$1', [invoiceNumber]);
  const account = await pool.query('SELECT 1 FROM wallet_accounts WHERE tenant_id=$1', [tenantId]);
  assert.equal(events.rowCount, 0);
  assert.equal(account.rowCount, 0);
});

test('signed amount mismatch and failed payment status never credit balance', async () => {
  const mismatch = await seedTopup();
  assert.deepEqual(await handleDuitkuCallback(callback(mismatch.invoiceNumber, { amount: '50001' })), { applied: false, reason: 'amount_mismatch' });
  const failed = await seedTopup();
  assert.deepEqual(await handleDuitkuCallback(callback(failed.invoiceNumber, { resultCode: '01' })), { applied: false, reason: 'status_01' });
  assert.equal((await pool.query('SELECT 1 FROM wallet_ledger WHERE tenant_id=$1', [mismatch.tenantId])).rowCount, 0);
  assert.equal((await pool.query('SELECT 1 FROM wallet_ledger WHERE tenant_id=$1', [failed.tenantId])).rowCount, 0);
});

test('unknown invoices and void legacy DOKU top-ups cannot receive credit', async () => {
  const missing = `TOP-TEST-${Date.now()}-UNKNOWN`;
  assert.deepEqual(await handleDuitkuCallback(callback(missing)), { applied: false, reason: 'invoice_not_found' });
  const old = await seedTopup('doku', 'void');
  assert.deepEqual(await handleDuitkuCallback(callback(old.invoiceNumber)), { applied: false, reason: 'wrong_provider' });
  assert.equal((await pool.query('SELECT 1 FROM wallet_ledger WHERE tenant_id=$1', [old.tenantId])).rowCount, 0);
});

test('migration 066 closes existing unpaid DOKU top-ups without deleting their audit rows', async () => {
  const row = (await pool.query<{ status: string; payment_provider: string }>(
    "SELECT status,payment_provider FROM wallet_topups WHERE invoice_number='TOP-LEGACY-MIGRATION'",
  )).rows[0];
  assert.deepEqual(row, { status: 'void', payment_provider: 'doku' });
});
