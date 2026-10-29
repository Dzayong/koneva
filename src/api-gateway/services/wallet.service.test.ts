import assert from 'node:assert/strict';
import { test } from 'node:test';
import { creditWalletWithClient, reserveMessageCharge } from './wallet.service';

class WalletDb {
  enabled = true;
  price = 100;
  available = 500;
  reserved = 0;
  lifetimeSpent = 0;
  reservations = new Map<string, { amount_idr: number; billing_category: string; pricing_tier_code: string; usage_before_idr: number }>();
  ledger = new Map<string, { amount_idr: number; event_type: string }>();
  lastLedgerSql = '';
  async query(text: string, values: unknown[] = []) {
    if (text.includes('SELECT enabled,price_per_message_idr FROM payg_settings')) return { rows: [{ enabled: this.enabled, price_per_message_idr: this.price }] };
    if (text.startsWith('INSERT INTO wallet_accounts')) return { rows: [], rowCount: 0 };
    if (text.includes('SELECT available_idr,lifetime_spent_idr FROM wallet_accounts')) return { rows: [{ available_idr: this.available, lifetime_spent_idr: this.lifetimeSpent }], rowCount: 1 };
    if (text.includes('SELECT amount_idr,billing_category,pricing_tier_code,usage_before_idr')) {
      const prior = this.reservations.get(`${values[0]}:${values[1]}`);
      return { rows: prior ? [prior] : [], rowCount: prior ? 1 : 0 };
    }
    if (text.includes('SELECT tenant_id FROM wallet_accounts')) return { rows: [{ tenant_id: values[0] }], rowCount: 1 };
    if (text.startsWith('SELECT') && text.includes('amount_idr') && text.includes('event_type') && text.includes('wallet_ledger') && text.includes('idempotency_key')) {
      const prior = this.ledger.get(String(values[1]));
      return { rows: prior ? [{ id: 'ledger-1', ...prior }] : [], rowCount: prior ? 1 : 0 };
    }
    if (text.includes('INSERT INTO message_wallet_reservations')) {
      const key = `${values[0]}:${values[1]}`;
      if (this.reservations.has(key)) return { rows: [], rowCount: 0 };
      this.reservations.set(key, {
        amount_idr: Number(values[3]), billing_category: String(values[4]),
        pricing_tier_code: String(values[5]), usage_before_idr: Number(values[6]),
      });
      return { rows: [{ message_id: values[0] }], rowCount: 1 };
    }
    if (text.startsWith('UPDATE wallet_accounts SET available_idr=available_idr-$2')) {
      this.available -= Number(values[1]); this.reserved += Number(values[1]);
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith('UPDATE wallet_accounts SET available_idr=available_idr+$2')) {
      this.available += Number(values[1]);
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('INSERT INTO wallet_ledger')) {
      this.lastLedgerSql = text;
      const event = text.includes("'topup'") ? 'topup' : text.includes("'voucher'") ? 'voucher' : 'reserve';
      const key = String(values[event === 'topup' || event === 'voucher' ? 2 : 2]);
      this.ledger.set(key, { amount_idr: Number(values[1]), event_type: event });
      return { rows: [{ id: 'ledger-new' }], rowCount: 1 };
    }
    throw new Error(`Unexpected wallet query: ${text}`);
  }
}

const queryable = (db: WalletDb) => db as never;

test('PAYG reserves a send before enqueue and rejects an empty wallet', async () => {
  const db = new WalletDb();
  const reserved = await reserveMessageCharge(queryable(db), 'tenant-1', 'message-1', 0);
  assert.deepEqual(reserved, { enabled: true, priceIdr: 15, billingCategory: 'api', pricingTierCode: 'starter', usageBeforeIdr: 0 });
  assert.equal(db.available, 485);
  assert.equal(db.reserved, 15);
  assert.match(db.lastLedgerSql, /-\(\$2::bigint\)/, 'reservation debit must have an explicit numeric type for PostgreSQL');

  db.available = 14;
  await assert.rejects(
    reserveMessageCharge(queryable(db), 'tenant-1', 'message-2', 0),
    (error: unknown) => Boolean(
      error && typeof error === 'object' && 'code' in error && error.code === 'INSUFFICIENT_WALLET_BALANCE'
      && 'message' in error && typeof error.message === 'string'
      && error.message.includes('Rp 14') && error.message.includes('Rp 15') && error.message.includes('Rp 1'),
    ),
  );
  assert.equal(db.reservations.has('message-2:0'), false);
});

test('PAYG snapshots the category and tier, then replays the same reservation without a second debit', async () => {
  const db = new WalletDb();
  db.available = 1_000;
  db.lifetimeSpent = 500_000;
  const first = await reserveMessageCharge(queryable(db), 'tenant-1', 'message-ai', 0, 'ai_reply');
  assert.deepEqual(first, { enabled: true, priceIdr: 48, billingCategory: 'ai_reply', pricingTierCode: 'growth', usageBeforeIdr: 500_000 });
  assert.equal(db.available, 952);

  db.lifetimeSpent = 2_500_000;
  const replay = await reserveMessageCharge(queryable(db), 'tenant-1', 'message-ai', 0, 'ai_reply');
  assert.deepEqual(replay, first);
  assert.equal(db.available, 952);
});

test('tier transitions exactly at Rp500k, Rp1.3M, Rp2.5M boundaries during reserve', async () => {
  const boundaries: Array<{ spent: number; expectedTier: string; expectedApi: number; expectedAuto: number; expectedAi: number }> = [
    { spent: 0, expectedTier: 'starter', expectedApi: 15, expectedAuto: 20, expectedAi: 50 },
    { spent: 499_999, expectedTier: 'starter', expectedApi: 15, expectedAuto: 20, expectedAi: 50 },
    { spent: 500_000, expectedTier: 'growth', expectedApi: 14, expectedAuto: 19, expectedAi: 48 },
    { spent: 1_299_999, expectedTier: 'growth', expectedApi: 14, expectedAuto: 19, expectedAi: 48 },
    { spent: 1_300_000, expectedTier: 'scale', expectedApi: 13, expectedAuto: 18, expectedAi: 46 },
    { spent: 2_499_999, expectedTier: 'scale', expectedApi: 13, expectedAuto: 18, expectedAi: 46 },
    { spent: 2_500_000, expectedTier: 'max', expectedApi: 12, expectedAuto: 17, expectedAi: 44 },
    { spent: 10_000_000, expectedTier: 'max', expectedApi: 12, expectedAuto: 17, expectedAi: 44 },
  ];

  for (const b of boundaries) {
    const db = new WalletDb();
    db.available = 10_000;
    db.lifetimeSpent = b.spent;

    const api = await reserveMessageCharge(queryable(db), 'tenant-1', `msg-api-${b.spent}`, 0, 'api');
    assert.equal(api.pricingTierCode, b.expectedTier, `api tier at spent=${b.spent}`);
    assert.equal(api.priceIdr, b.expectedApi, `api price at spent=${b.spent}`);

    const db2 = new WalletDb();
    db2.available = 10_000;
    db2.lifetimeSpent = b.spent;
    const auto = await reserveMessageCharge(queryable(db2), 'tenant-1', `msg-auto-${b.spent}`, 0, 'auto_reply');
    assert.equal(auto.priceIdr, b.expectedAuto, `auto price at spent=${b.spent}`);

    const db3 = new WalletDb();
    db3.available = 10_000;
    db3.lifetimeSpent = b.spent;
    const ai = await reserveMessageCharge(queryable(db3), 'tenant-1', `msg-ai-${b.spent}`, 0, 'ai_reply');
    assert.equal(ai.priceIdr, b.expectedAi, `ai price at spent=${b.spent}`);
  }
});

test('concurrent duplicate reserve for same message_id+attempt is rejected, no double debit', async () => {
  const db = new WalletDb();
  db.available = 1_000;
  const first = await reserveMessageCharge(queryable(db), 'tenant-1', 'msg-dup', 0, 'api');
  assert.equal(first.priceIdr, 15);
  assert.equal(db.available, 985);

  // Simulate concurrent call: reservation already exists in DB
  const second = await reserveMessageCharge(queryable(db), 'tenant-1', 'msg-dup', 0, 'api');
  assert.equal(second.priceIdr, 15);
  assert.equal(db.available, 985, 'balance must NOT decrease on replay');
});

test('different attempt_no for same message creates separate reservation', async () => {
  const db = new WalletDb();
  db.available = 1_000;
  const attempt0 = await reserveMessageCharge(queryable(db), 'tenant-1', 'msg-retry', 0, 'api');
  assert.equal(attempt0.priceIdr, 15);
  assert.equal(db.available, 985);

  const attempt1 = await reserveMessageCharge(queryable(db), 'tenant-1', 'msg-retry', 1, 'api');
  assert.equal(attempt1.priceIdr, 15);
  assert.equal(db.available, 970, 'retry is a new charge');
});

test('PAYG disabled returns zero charge without touching wallet', async () => {
  const db = new WalletDb();
  db.enabled = false;
  db.available = 500;
  const result = await reserveMessageCharge(queryable(db), 'tenant-1', 'msg-disabled', 0, 'api');
  assert.equal(result.enabled, false);
  assert.equal(result.priceIdr, 0);
  assert.equal(db.available, 500, 'balance unchanged when PAYG disabled');
});

test('credit with mismatched amount on same idempotency key is rejected', async () => {
  const db = new WalletDb();
  await creditWalletWithClient(queryable(db), 'tenant-1', 50_000, 'doku:x1', 'TOP-X1');
  // Store the ledger entry with correct type for the check
  db.ledger.set('doku:x1', { amount_idr: 50_000, event_type: 'topup' });
  await assert.rejects(
    creditWalletWithClient(queryable(db), 'tenant-1', 75_000, 'doku:x1', 'TOP-X1'),
    (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'WALLET_IDEMPOTENCY_CONFLICT'),
  );
});

test('verified top-up credit uses an idempotency key and cannot be applied twice', async () => {
  const db = new WalletDb();
  const first = await creditWalletWithClient(queryable(db), 'tenant-1', 50_000, 'doku:request-1', 'TOP-1');
  const replay = await creditWalletWithClient(queryable(db), 'tenant-1', 50_000, 'doku:request-1', 'TOP-1');
  assert.deepEqual(first, { replay: false });
  assert.deepEqual(replay, { replay: true });
  assert.equal(db.available, 50_500);
});

test('reservation records billing_category and pricing snapshot for three categories', async () => {
  for (const cat of ['api', 'auto_reply', 'ai_reply'] as const) {
    const db = new WalletDb();
    db.available = 10_000;
    db.lifetimeSpent = 0;
    const result = await reserveMessageCharge(queryable(db), 'tenant-1', `msg-${cat}`, 0, cat);
    assert.equal(result.billingCategory, cat);
    assert.equal(result.pricingTierCode, 'starter');
    assert.equal(result.usageBeforeIdr, 0);
    const key = `msg-${cat}:0`;
    const stored = db.reservations.get(key)!;
    assert.equal(stored.billing_category, cat, `reservation must store category=${cat}`);
    assert.equal(stored.pricing_tier_code, 'starter');
    assert.equal(stored.usage_before_idr, 0);
  }
});

test('insufficient balance on AI at max tier is rejected correctly', async () => {
  const db = new WalletDb();
  db.available = 43;
  db.lifetimeSpent = 2_500_000;
  await assert.rejects(
    reserveMessageCharge(queryable(db), 'tenant-1', 'msg-ai-short', 0, 'ai_reply'),
    (error: unknown) => Boolean(
      error && typeof error === 'object' && 'code' in error && error.code === 'INSUFFICIENT_WALLET_BALANCE',
    ),
    'AI at max tier costs 44 IDR, available 43 should be rejected',
  );
});

test('voucher credit with correct idempotency replays without double credit', async () => {
  const db = new WalletDb();
  const { creditSignupVoucherWithClient } = await import('./wallet.service');
  db.ledger.clear();
  const first = await creditSignupVoucherWithClient(queryable(db), 'tenant-1', 25_000, 'voucher:v1', 'VCR-1');
  assert.ok(first.id !== undefined);
  db.ledger.set('voucher:v1', { amount_idr: 25_000, event_type: 'voucher' });
  const replay = await creditSignupVoucherWithClient(queryable(db), 'tenant-1', 25_000, 'voucher:v1', 'VCR-1');
  assert.ok(replay.id !== undefined, 'replay returns existing id');
});

test('voucher credit with mismatched amount on same key is rejected', async () => {
  const { creditSignupVoucherWithClient } = await import('./wallet.service');
  const db = new WalletDb();
  await creditSignupVoucherWithClient(queryable(db), 'tenant-1', 25_000, 'voucher:v2', 'VCR-2');
  db.ledger.set('voucher:v2', { amount_idr: 25_000, event_type: 'voucher' });
  await assert.rejects(
    creditSignupVoucherWithClient(queryable(db), 'tenant-1', 50_000, 'voucher:v2', 'VCR-2'),
    (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'WALLET_IDEMPOTENCY_CONFLICT'),
  );
});
