import type { PoolClient, QueryResultRow } from 'pg';
import pool, { transaction } from '../../shared/database/connection';
import { ServiceError } from './service-error';

type Db = Pick<PoolClient, 'query'>;
type PaygSettingsRow = QueryResultRow & { enabled: boolean; price_per_message_idr: number | string | null };

function idr(value: number | string | null | undefined): number {
  const amount = Number(value ?? 0);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new ServiceError(503, 'WALLET_DATA_INVALID', 'Data saldo tidak valid.');
  return amount;
}

export async function currentPaygSettings(db: Db) {
  const row = (await db.query<PaygSettingsRow>(
    'SELECT enabled,price_per_message_idr FROM payg_settings WHERE singleton=true',
  )).rows[0];
  return {
    enabled: row?.enabled ?? false,
    pricePerMessageIdr: row?.price_per_message_idr == null ? null : idr(row.price_per_message_idr),
  };
}

/** Reserve one send at enqueue time. The tenant row lock makes concurrent sends consume distinct funds. */
export async function reserveMessageCharge(db: Db, tenantId: string, messageId: string, attemptNo = 0): Promise<{ enabled: boolean; priceIdr: number }> {
  const settings = await currentPaygSettings(db);
  if (!settings.enabled) return { enabled: false, priceIdr: 0 };
  if (!settings.pricePerMessageIdr) throw new ServiceError(503, 'PAYG_RATE_NOT_CONFIGURED', 'Tarif PAYG belum disetel oleh KONEVA.');

  await db.query('INSERT INTO wallet_accounts(tenant_id) VALUES($1) ON CONFLICT(tenant_id) DO NOTHING', [tenantId]);
  const account = (await db.query<QueryResultRow & { available_idr: number | string }>(
    'SELECT available_idr FROM wallet_accounts WHERE tenant_id=$1 FOR UPDATE', [tenantId],
  )).rows[0];
  const available = idr(account?.available_idr);
  if (available < settings.pricePerMessageIdr) {
    const rupiah = (amount: number) => new Intl.NumberFormat('id-ID', {
      style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
    }).format(amount);
    const shortfall = settings.pricePerMessageIdr - available;
    throw new ServiceError(
      402,
      'INSUFFICIENT_WALLET_BALANCE',
      `Saldo PAYG tidak cukup. Saldo tersedia ${rupiah(available)}; tarif ${rupiah(settings.pricePerMessageIdr)} per pesan. Tambahkan minimal ${rupiah(shortfall)} untuk mengantrekan satu pesan berikutnya. Isi saldo melalui Tagihan → Saldo PAYG.`,
    );
  }

  const reserved = await db.query(
    `INSERT INTO message_wallet_reservations(message_id,attempt_no,tenant_id,amount_idr,state)
     VALUES($1,$2,$3,$4,'reserved') ON CONFLICT(message_id,attempt_no) DO NOTHING RETURNING message_id`,
    [messageId, attemptNo, tenantId, settings.pricePerMessageIdr],
  );
  if (!reserved.rowCount) return { enabled: true, priceIdr: settings.pricePerMessageIdr };

  await db.query(`UPDATE wallet_accounts SET available_idr=available_idr-$2,
    reserved_idr=reserved_idr+$2, updated_at=now() WHERE tenant_id=$1`, [tenantId, settings.pricePerMessageIdr]);
  await db.query(`INSERT INTO wallet_ledger(tenant_id,event_type,amount_idr,available_delta_idr,reserved_delta_idr,idempotency_key,message_id,attempt_no)
    VALUES($1,'reserve',$2::bigint,-($2::bigint),$2::bigint,$3,$4,$5)`, [tenantId, settings.pricePerMessageIdr,
    `message:${messageId}:${attemptNo}:reserve`, messageId, attemptNo]);
  return { enabled: true, priceIdr: settings.pricePerMessageIdr };
}

/** Credit only from a verified, idempotent payment event, inside the caller's transaction. */
export async function creditWalletWithClient(db: Db, tenantId: string, amountIdr: number, idempotencyKey: string, invoiceNumber: string): Promise<{ replay: boolean }> {
  if (!Number.isSafeInteger(amountIdr) || amountIdr < 1 || amountIdr > 100_000_000) {
    throw new ServiceError(400, 'INVALID_TOPUP_AMOUNT', 'Nominal isi saldo tidak valid.');
  }
  await db.query('INSERT INTO wallet_accounts(tenant_id) VALUES($1) ON CONFLICT(tenant_id) DO NOTHING', [tenantId]);
  await db.query('SELECT tenant_id FROM wallet_accounts WHERE tenant_id=$1 FOR UPDATE', [tenantId]);
  const prior = (await db.query<QueryResultRow & { amount_idr: number | string; event_type: string }>(
    'SELECT amount_idr,event_type FROM wallet_ledger WHERE tenant_id=$1 AND idempotency_key=$2', [tenantId, idempotencyKey],
  )).rows[0];
  if (prior) {
    if (prior.event_type !== 'topup' || idr(prior.amount_idr) !== amountIdr) throw new ServiceError(409, 'WALLET_IDEMPOTENCY_CONFLICT', 'Referensi pembayaran sudah digunakan dengan nominal berbeda.');
    return { replay: true };
  }
  await db.query('UPDATE wallet_accounts SET available_idr=available_idr+$2,updated_at=now() WHERE tenant_id=$1', [tenantId, amountIdr]);
  await db.query(`INSERT INTO wallet_ledger(tenant_id,event_type,amount_idr,available_delta_idr,reserved_delta_idr,idempotency_key,invoice_number)
    VALUES($1,'topup',$2,$2,0,$3,$4)`, [tenantId, amountIdr, idempotencyKey, invoiceNumber]);
  return { replay: false };
}

/** Apply a signup voucher as a distinct, idempotent wallet ledger credit. */
export async function creditSignupVoucherWithClient(db: Db, tenantId: string, amountIdr: number,
  idempotencyKey: string, invoiceNumber: string): Promise<{ id: string | number }> {
  if (!Number.isSafeInteger(amountIdr) || amountIdr < 1 || amountIdr > 100_000_000) {
    throw new ServiceError(503, 'VOUCHER_DATA_INVALID', 'Nominal voucher tidak valid.');
  }
  await db.query('INSERT INTO wallet_accounts(tenant_id) VALUES($1) ON CONFLICT(tenant_id) DO NOTHING', [tenantId]);
  await db.query('SELECT tenant_id FROM wallet_accounts WHERE tenant_id=$1 FOR UPDATE', [tenantId]);
  const prior = (await db.query<QueryResultRow & { id: string | number; amount_idr: number | string; event_type: string }>(
    'SELECT id,amount_idr,event_type FROM wallet_ledger WHERE tenant_id=$1 AND idempotency_key=$2', [tenantId, idempotencyKey],
  )).rows[0];
  if (prior) {
    if (prior.event_type !== 'voucher' || idr(prior.amount_idr) !== amountIdr) {
      throw new ServiceError(409, 'WALLET_IDEMPOTENCY_CONFLICT', 'Voucher sudah diterapkan dengan nominal berbeda.');
    }
    return { id: prior.id };
  }
  await db.query('UPDATE wallet_accounts SET available_idr=available_idr+$2,updated_at=now() WHERE tenant_id=$1', [tenantId, amountIdr]);
  const entry = (await db.query<QueryResultRow & { id: string | number }>(
    `INSERT INTO wallet_ledger(tenant_id,event_type,amount_idr,available_delta_idr,reserved_delta_idr,idempotency_key,invoice_number)
     VALUES($1,'voucher',$2,$2,0,$3,$4) RETURNING id`, [tenantId, amountIdr, idempotencyKey, invoiceNumber],
  )).rows[0]!;
  return { id: entry.id };
}

export async function getWalletState(tenantId: string) {
  const [account, settings, counts, devices, topups] = await Promise.all([
    pool.query<QueryResultRow & { available_idr: number | string; reserved_idr: number | string }>(
      'SELECT available_idr,reserved_idr FROM wallet_accounts WHERE tenant_id=$1', [tenantId]),
    pool.query<PaygSettingsRow>('SELECT enabled,price_per_message_idr FROM payg_settings WHERE singleton=true'),
    pool.query<QueryResultRow & { sent: number; failed: number }>(
      `SELECT count(*) FILTER (WHERE status IN ('sent','delivered','read'))::int AS sent,
              count(*) FILTER (WHERE status IN ('failed','blocked'))::int AS failed
       FROM messages WHERE tenant_id=$1 AND system_otp=false AND system_notification=false`, [tenantId]),
    pool.query<QueryResultRow & { device_key: string; sent: number; failed: number; charged_idr: number | string }>(
      `SELECT m.device_key,
              count(DISTINCT m.id) FILTER (WHERE m.status IN ('sent','delivered','read'))::int AS sent,
              count(DISTINCT m.id) FILTER (WHERE m.status IN ('failed','blocked'))::int AS failed,
              COALESCE(sum(r.amount_idr) FILTER (WHERE r.state='captured'),0)::bigint AS charged_idr
       FROM messages m LEFT JOIN message_wallet_reservations r ON r.message_id=m.id
       WHERE m.tenant_id=$1 AND m.system_otp=false AND m.system_notification=false
       GROUP BY m.device_key ORDER BY m.device_key`, [tenantId]),
    pool.query<QueryResultRow & { invoice_number: string; amount_idr: number | string; status: string; created_at: Date }>(
      `SELECT invoice_number,amount_idr,status,created_at FROM (
         SELECT invoice_number,amount_idr,status,created_at FROM wallet_topups WHERE tenant_id=$1
         UNION ALL
         SELECT invoice_number,amount_idr,'paid'::varchar AS status,created_at
           FROM wallet_ledger WHERE tenant_id=$1 AND event_type='voucher'
       ) credits ORDER BY created_at DESC LIMIT 10`, [tenantId]),
  ]);
  const wallet = account.rows[0];
  const setting = settings.rows[0];
  return {
    enabled: setting?.enabled ?? false,
    price_per_message_idr: setting?.price_per_message_idr == null ? null : idr(setting.price_per_message_idr),
    available_idr: idr(wallet?.available_idr), reserved_idr: idr(wallet?.reserved_idr),
    messages_sent: counts.rows[0]?.sent ?? 0, messages_failed: counts.rows[0]?.failed ?? 0,
    devices: devices.rows.map((row) => ({ device_key: row.device_key, messages_sent: row.sent, messages_failed: row.failed, charged_idr: idr(row.charged_idr) })),
    recent_topups: topups.rows.map((row) => ({ invoice_number: row.invoice_number, amount_idr: idr(row.amount_idr), status: row.status, created_at: row.created_at })),
  };
}

export async function createWalletTopup(tenantId: string, amountIdr: number) {
  if (!Number.isSafeInteger(amountIdr) || amountIdr < 10000 || amountIdr > 10_000_000) {
    throw new ServiceError(400, 'INVALID_TOPUP_AMOUNT', 'Isi saldo harus antara Rp10.000 dan Rp10.000.000.');
  }
  return transaction(async (client) => {
    const payg = await currentPaygSettings(client);
    if (!payg.enabled) throw new ServiceError(409, 'PAYG_NOT_ACTIVE', 'Isi saldo PAYG belum tersedia.');
    const tenant = (await client.query<{ name: string; email: string | null }>(
      'SELECT name,email FROM tenants WHERE id=$1 FOR UPDATE', [tenantId],
    )).rows[0];
    if (!tenant) throw new ServiceError(404, 'TENANT_NOT_FOUND', 'Workspace tidak ditemukan.');
    const invoice = (await client.query<{ invoice_number: string; amount_idr: number }>(
      `INSERT INTO wallet_topups(tenant_id,invoice_number,amount_idr,payment_provider)
       VALUES($1,'TOP-'||to_char(now(),'YYYYMM')||'-'||lpad(nextval('invoice_number_seq')::text,4,'0'),$2,'duitku')
       RETURNING invoice_number,amount_idr`, [tenantId, amountIdr],
    )).rows[0]!;
    return { ...invoice, customer: { id: tenantId, name: tenant.name, email: tenant.email } };
  });
}

export async function updateWalletTopupProviderReference(invoiceNumber: string, providerReference: string): Promise<void> {
  await pool.query(
    `UPDATE wallet_topups SET provider_reference=$2 WHERE invoice_number=$1 AND payment_provider='duitku' AND status='unpaid'`,
    [invoiceNumber, providerReference],
  );
}

export async function voidWalletTopup(invoiceNumber: string): Promise<void> {
  await pool.query(
    `UPDATE wallet_topups SET status='void' WHERE invoice_number=$1 AND payment_provider='duitku' AND status='unpaid'`,
    [invoiceNumber],
  );
}

export async function creditWallet(tenantId: string, amountIdr: number, idempotencyKey: string, invoiceNumber: string) {
  return transaction(async (client) => {
    await client.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE', [tenantId]);
    return creditWalletWithClient(client, tenantId, amountIdr, idempotencyKey, invoiceNumber);
  });
}
