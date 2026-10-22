import assert from 'node:assert/strict';
import { test } from 'node:test';
import { creditWalletWithClient, reserveMessageCharge } from './wallet.service';

class WalletDb {
  enabled = true;
  price = 100;
  available = 500;
  reserved = 0;
  reservations = new Set<string>();
  ledger = new Map<string, { amount_idr: number; event_type: string }>();
  async query(text: string, values: unknown[] = []) {
    if (text.includes('SELECT enabled,price_per_message_idr FROM payg_settings')) return { rows: [{ enabled: this.enabled, price_per_message_idr: this.price }] };
    if (text.startsWith('INSERT INTO wallet_accounts')) return { rows: [], rowCount: 0 };
    if (text.includes('SELECT available_idr FROM wallet_accounts')) return { rows: [{ available_idr: this.available }], rowCount: 1 };
    if (text.includes('SELECT tenant_id FROM wallet_accounts')) return { rows: [{ tenant_id: values[0] }], rowCount: 1 };
    if (text.includes('SELECT amount_idr,event_type FROM wallet_ledger')) {
      const prior = this.ledger.get(String(values[1]));
      return { rows: prior ? [prior] : [], rowCount: prior ? 1 : 0 };
    }
    if (text.includes('INSERT INTO message_wallet_reservations')) {
      const key = `${values[0]}:${values[1]}`;
      if (this.reservations.has(key)) return { rows: [], rowCount: 0 };
      this.reservations.add(key);
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
      const event = text.includes("'topup'") ? 'topup' : 'reserve';
      const key = String(values[event === 'topup' ? 2 : 2]);
      this.ledger.set(key, { amount_idr: Number(values[1]), event_type: event });
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected wallet query: ${text}`);
  }
}

const queryable = (db: WalletDb) => db as never;

test('PAYG reserves a send before enqueue and rejects an empty wallet', async () => {
  const db = new WalletDb();
  const reserved = await reserveMessageCharge(queryable(db), 'tenant-1', 'message-1', 0);
  assert.deepEqual(reserved, { enabled: true, priceIdr: 100 });
  assert.equal(db.available, 400);
  assert.equal(db.reserved, 100);

  db.available = 99;
  await assert.rejects(
    reserveMessageCharge(queryable(db), 'tenant-1', 'message-2', 0),
    (error: unknown) => Boolean(
      error && typeof error === 'object' && 'code' in error && error.code === 'INSUFFICIENT_WALLET_BALANCE'
      && 'message' in error && typeof error.message === 'string'
      && error.message.includes('Rp 99') && error.message.includes('Rp 100') && error.message.includes('Rp 1'),
    ),
  );
  assert.equal(db.reservations.has('message-2:0'), false);
});

test('verified top-up credit uses an idempotency key and cannot be applied twice', async () => {
  const db = new WalletDb();
  const first = await creditWalletWithClient(queryable(db), 'tenant-1', 50_000, 'doku:request-1', 'TOP-1');
  const replay = await creditWalletWithClient(queryable(db), 'tenant-1', 50_000, 'doku:request-1', 'TOP-1');
  assert.deepEqual(first, { replay: false });
  assert.deepEqual(replay, { replay: true });
  assert.equal(db.available, 50_500);
});
