import type { PoolClient, QueryResultRow } from 'pg';
import pool, { transaction } from '../../shared/database/connection';
import { paygPricingTier, type PaygBillingCategory } from '../../shared/payg-pricing';
import { recordSystemNotification } from './system-notification-outbox';
import { ServiceError } from './service-error';
import logger from '../../shared/utils/logger';
import { walletOperationsTotal, messagesQueuedTotal } from '../metrics';

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

export interface MessageChargeSnapshot {
  enabled: boolean;
  priceIdr: number;
  billingCategory: PaygBillingCategory;
  pricingTierCode: string;
  usageBeforeIdr: number;
}

/** Debit one send at enqueue time. The tenant row lock makes the tier decision atomic and repeatable. */
export async function reserveMessageCharge(db: Db, tenantId: string, messageId: string, attemptNo = 0,
  billingCategory: PaygBillingCategory = 'api'): Promise<MessageChargeSnapshot> {
  const settings = await currentPaygSettings(db);
  if (!settings.enabled) return {
    enabled: false, priceIdr: 0, billingCategory, pricingTierCode: 'disabled', usageBeforeIdr: 0,
  };

  await db.query('INSERT INTO wallet_accounts(tenant_id) VALUES($1) ON CONFLICT(tenant_id) DO NOTHING', [tenantId]);
  const account = (await db.query<QueryResultRow & { available_idr: number | string; lifetime_spent_idr: number | string }>(
    'SELECT available_idr,lifetime_spent_idr FROM wallet_accounts WHERE tenant_id=$1 FOR UPDATE', [tenantId],
  )).rows[0];
  const available = idr(account?.available_idr);
  const prior = (await db.query<QueryResultRow & {
    amount_idr: number | string;
    billing_category: PaygBillingCategory;
    pricing_tier_code: string;
    usage_before_idr: number | string;
  }>(
    `SELECT amount_idr,billing_category,pricing_tier_code,usage_before_idr
       FROM message_wallet_reservations WHERE message_id=$1 AND attempt_no=$2`, [messageId, attemptNo],
  )).rows[0];
  if (prior) return {
    enabled: true,
    priceIdr: idr(prior.amount_idr),
    billingCategory: prior.billing_category,
    pricingTierCode: prior.pricing_tier_code,
    usageBeforeIdr: idr(prior.usage_before_idr),
  };

  const usageBeforeIdr = idr(account?.lifetime_spent_idr);
  const tier = paygPricingTier(usageBeforeIdr);
  const priceIdr = tier.prices[billingCategory];
  if (available < priceIdr) {
    const rupiah = (amount: number) => new Intl.NumberFormat('id-ID', {
      style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
    }).format(amount);
    walletOperationsTotal.inc({ operation: 'reserve', outcome: 'insufficient_balance' });
    const shortfall = priceIdr - available;
    throw new ServiceError(
      402,
      'INSUFFICIENT_WALLET_BALANCE',
      `Saldo PAYG tidak cukup. Saldo tersedia ${rupiah(available)}; tarif ${rupiah(priceIdr)} per pesan. Tambahkan minimal ${rupiah(shortfall)} untuk mengantrekan satu pesan berikutnya. Isi saldo melalui Top up.`,
    );
  }

  const reserved = await db.query(
    `INSERT INTO message_wallet_reservations(
       message_id,attempt_no,tenant_id,amount_idr,state,billing_category,unit_price_idr,pricing_tier_code,usage_before_idr)
     VALUES($1,$2,$3,$4,'debited',$5,$4,$6,$7)
     ON CONFLICT(message_id,attempt_no) DO NOTHING RETURNING message_id`,
    [messageId, attemptNo, tenantId, priceIdr, billingCategory, tier.code, usageBeforeIdr],
  );
  if (!reserved.rowCount) throw new ServiceError(409, 'WALLET_RESERVATION_CONFLICT', 'Biaya pesan sudah dicatat. Coba muat ulang.');

  await db.query(`UPDATE wallet_accounts SET available_idr=available_idr-$2, updated_at=now() WHERE tenant_id=$1`, [tenantId, priceIdr]);
  await db.query(`INSERT INTO wallet_ledger(
      tenant_id,event_type,amount_idr,available_delta_idr,reserved_delta_idr,idempotency_key,message_id,attempt_no,
      billing_category,unit_price_idr,pricing_tier_code,usage_before_idr)
    VALUES($1,'adjustment',$2::bigint,-($2::bigint),0,$3,$4,$5,$6,$2,$7,$8)`, [tenantId, priceIdr,
    `message:${messageId}:${attemptNo}:debit`, messageId, attemptNo, billingCategory, tier.code, usageBeforeIdr]);

  walletOperationsTotal.inc({ operation: 'reserve', outcome: 'success' });
  messagesQueuedTotal.inc({ billing_category: billingCategory });

  checkLowBalanceNotification(tenantId, available - priceIdr).catch((err) =>
    logger.warn('low-balance notification check failed', { tenantId, error: err }),
  );

  return { enabled: true, priceIdr, billingCategory, pricingTierCode: tier.code, usageBeforeIdr };
}

const LOW_BALANCE_THRESHOLD = 0.20;

async function checkLowBalanceNotification(tenantId: string, currentAvailable: number): Promise<void> {
  const { rows } = await pool.query<{ total_funded_idr: number | string; topup_count: number | string }>(
    `SELECT COALESCE(sum(amount_idr), 0)::bigint AS total_funded_idr, count(*)::int AS topup_count
     FROM (
       SELECT amount_idr FROM wallet_topups WHERE tenant_id=$1 AND status='paid'
       UNION ALL
       SELECT amount_idr FROM wallet_ledger WHERE tenant_id=$1 AND event_type='voucher'
     ) credits`,
    [tenantId],
  );
  const totalFunded = Number(rows[0]?.total_funded_idr ?? 0);
  const topupCount = Number(rows[0]?.topup_count ?? 0);
  if (totalFunded <= 0) return;

  const threshold = Math.round(totalFunded * LOW_BALANCE_THRESHOLD);
  if (currentAvailable > threshold) return;

  const rupiah = (n: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
  const eventKey = `balance-low:${tenantId}:gen-${topupCount}`;

  await recordSystemNotification(
    pool,
    eventKey,
    'balance.low',
    `⚠️ Saldo KONEVA Anda tinggal ${rupiah(currentAvailable)} (di bawah 20% dari total isi saldo ${rupiah(totalFunded)}). Segera isi ulang agar pengiriman pesan tidak terhenti.`,
  );
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
  walletOperationsTotal.inc({ operation: 'topup', outcome: 'success' });
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
    pool.query<QueryResultRow & {
      available_idr: number | string;
      lifetime_spent_idr: number | string;
      lifetime_messages_charged: number | string;
    }>(
      `SELECT available_idr,lifetime_spent_idr,lifetime_messages_charged
         FROM wallet_accounts WHERE tenant_id=$1`, [tenantId]),
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
  const spentIdr = idr(wallet?.lifetime_spent_idr);
  const tier = paygPricingTier(spentIdr);
  return {
    enabled: setting?.enabled ?? false,
    // Kept for older clients. New clients should use prices by billing category.
    price_per_message_idr: tier.prices.api,
    pricing_tier: tier.code,
    prices: tier.prices,
    next_tier_at_idr: tier.nextAtIdr,
    amount_to_next_tier_idr: tier.nextAtIdr == null ? null : tier.nextAtIdr - spentIdr,
    available_idr: idr(wallet?.available_idr),
    messages_charged: idr(wallet?.lifetime_messages_charged),
    spent_idr: spentIdr,
    messages_sent: counts.rows[0]?.sent ?? 0, messages_failed: counts.rows[0]?.failed ?? 0,
    devices: devices.rows.map((row) => ({ device_key: row.device_key, messages_sent: row.sent, messages_failed: row.failed, charged_idr: idr(row.charged_idr) })),
    recent_topups: topups.rows.map((row) => ({ invoice_number: row.invoice_number, amount_idr: idr(row.amount_idr), status: row.status, created_at: row.created_at })),
  };
}

// ---------------------------------------------------------------------------
// Usage history: paginated message-level billing records
// ---------------------------------------------------------------------------

export interface UsageHistoryFilters {
  tenantId: string;
  deviceKey?: string | undefined;
  billingCategory?: PaygBillingCategory | undefined;
  status?: 'charged' | 'refunded' | 'pending' | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  limit: number;
  offset: number;
}

interface UsageHistoryRow {
  message_id: string;
  device_key: string;
  to_number: string;
  content_preview: string;
  message_type: string;
  message_status: string;
  billing_category: PaygBillingCategory;
  unit_price_idr: number;
  charged_idr: number;
  reservation_state: string;
  pricing_tier_code: string;
  created_at: Date;
  sent_at: Date | null;
  refunded: boolean;
}

interface UsageHistorySummary {
  total_attempts: number;
  total_charged: number;
  total_successful: number;
  total_failed_refunded: number;
  total_spend_idr: number;
  total_refunded_idr: number;
}

function buildUsageWhere(filters: UsageHistoryFilters) {
  const conditions: string[] = ['m.tenant_id = $1', 'm.direction = \'outbound\'', 'm.system_otp = false', 'm.system_notification = false'];
  const params: unknown[] = [filters.tenantId];
  let idx = 2;

  if (filters.deviceKey) {
    conditions.push(`m.device_key = $${idx}`);
    params.push(filters.deviceKey);
    idx += 1;
  }
  if (filters.billingCategory) {
    conditions.push(`r.billing_category = $${idx}`);
    params.push(filters.billingCategory);
    idx += 1;
  }
  if (filters.status) {
    const stateMap = { charged: 'captured', refunded: 'released', pending: 'debited' } as const;
    conditions.push(`r.state = $${idx}`);
    params.push(stateMap[filters.status]);
    idx += 1;
  }
  if (filters.dateFrom) {
    conditions.push(`m.created_at >= $${idx}::timestamptz`);
    params.push(filters.dateFrom + 'T00:00:00Z');
    idx += 1;
  }
  if (filters.dateTo) {
    conditions.push(`m.created_at < $${idx}::timestamptz`);
    params.push(filters.dateTo + 'T24:00:00Z');
    idx += 1;
  }

  return { where: conditions.join(' AND '), params, nextIdx: idx };
}

export async function getUsageHistory(filters: UsageHistoryFilters) {
  const { where, params, nextIdx } = buildUsageWhere(filters);

  const [rows, countRow, summaryRow] = await Promise.all([
    pool.query<UsageHistoryRow>(
      `SELECT m.id AS message_id, m.device_key, m.to_number,
              left(m.content, 60) AS content_preview, m.type AS message_type,
              m.status AS message_status,
              r.billing_category, r.unit_price_idr::int AS unit_price_idr,
              r.amount_idr::int AS charged_idr, r.state AS reservation_state,
              r.pricing_tier_code,
              m.created_at, m.sent_at,
              (r.state = 'released') AS refunded
       FROM messages m
       INNER JOIN message_wallet_reservations r ON r.message_id = m.id AND r.attempt_no = m.retry_count
       WHERE ${where}
       ORDER BY m.created_at DESC
       LIMIT $${nextIdx} OFFSET $${nextIdx + 1}`,
      [...params, filters.limit, filters.offset],
    ),
    pool.query<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM messages m
       INNER JOIN message_wallet_reservations r ON r.message_id = m.id AND r.attempt_no = m.retry_count
       WHERE ${where}`,
      params,
    ),
    pool.query<UsageHistorySummary>(
      `SELECT count(*)::int AS total_attempts,
              count(*) FILTER (WHERE r.state = 'captured')::int AS total_charged,
              count(*) FILTER (WHERE m.status IN ('sent','delivered','read'))::int AS total_successful,
              count(*) FILTER (WHERE r.state = 'released')::int AS total_failed_refunded,
              COALESCE(sum(r.amount_idr) FILTER (WHERE r.state = 'captured'), 0)::bigint AS total_spend_idr,
              COALESCE(sum(r.amount_idr) FILTER (WHERE r.state = 'released'), 0)::bigint AS total_refunded_idr
       FROM messages m
       INNER JOIN message_wallet_reservations r ON r.message_id = m.id AND r.attempt_no = m.retry_count
       WHERE ${where}`,
      params,
    ),
  ]);

  const total = countRow.rows[0]?.total ?? 0;
  const summary = summaryRow.rows[0] ?? {
    total_attempts: 0, total_charged: 0, total_successful: 0,
    total_failed_refunded: 0, total_spend_idr: 0, total_refunded_idr: 0,
  };

  return {
    data: rows.rows.map((r) => ({
      message_id: r.message_id,
      device_key: r.device_key,
      to_number: r.to_number,
      content_preview: r.content_preview,
      message_type: r.message_type,
      message_status: r.message_status,
      billing_category: r.billing_category,
      unit_price_idr: Number(r.unit_price_idr),
      charged_idr: Number(r.charged_idr),
      reservation_state: r.reservation_state,
      pricing_tier_code: r.pricing_tier_code,
      created_at: r.created_at,
      sent_at: r.sent_at,
      refunded: r.refunded,
    })),
    summary: {
      total_attempts: Number(summary.total_attempts),
      total_charged: Number(summary.total_charged),
      total_successful: Number(summary.total_successful),
      total_failed_refunded: Number(summary.total_failed_refunded),
      total_spend_idr: Number(summary.total_spend_idr),
      total_refunded_idr: Number(summary.total_refunded_idr),
    },
    pagination: { limit: filters.limit, offset: filters.offset, total, has_more: filters.offset + filters.limit < total },
  };
}

export async function getUsageHistoryCsv(filters: Omit<UsageHistoryFilters, 'limit' | 'offset'>): Promise<string> {
  const fullFilters = { ...filters, limit: 50000, offset: 0 };
  const { where, params, nextIdx } = buildUsageWhere(fullFilters);

  const { rows } = await pool.query<UsageHistoryRow>(
    `SELECT m.id AS message_id, m.device_key, m.to_number,
            left(m.content, 60) AS content_preview, m.type AS message_type,
            m.status AS message_status,
            r.billing_category, r.unit_price_idr::int AS unit_price_idr,
            r.amount_idr::int AS charged_idr, r.state AS reservation_state,
            r.pricing_tier_code,
            m.created_at, m.sent_at,
            (r.state = 'released') AS refunded
     FROM messages m
     INNER JOIN message_wallet_reservations r ON r.message_id = m.id AND r.attempt_no = m.retry_count
     WHERE ${where}
     ORDER BY m.created_at DESC
     LIMIT $${nextIdx}`,
    [...params, fullFilters.limit],
  );

  const header = 'Waktu,Device,Penerima,Kategori,Tipe,Status Pesan,Status Biaya,Tarif,Biaya,Tier,Refund\n';
  const csvRows = rows.map((r) => {
    const cat = { api: 'API', auto_reply: 'Otomatis', ai_reply: 'AI' }[r.billing_category] ?? r.billing_category;
    const state = { captured: 'Tertagih', released: 'Dikembalikan', debited: 'Menunggu' }[r.reservation_state] ?? r.reservation_state;
    const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
    return [
      new Date(r.created_at).toISOString(),
      r.device_key,
      r.to_number,
      cat,
      r.message_type,
      r.message_status,
      state,
      r.unit_price_idr,
      r.charged_idr,
      r.pricing_tier_code,
      r.refunded ? 'Ya' : 'Tidak',
    ].map((v) => typeof v === 'string' ? escape(v) : v).join(',');
  });

  return header + csvRows.join('\n');
}

export async function getUsageDeviceKeys(tenantId: string): Promise<string[]> {
  const { rows } = await pool.query<{ device_key: string }>(
    `SELECT DISTINCT m.device_key
     FROM messages m
     INNER JOIN message_wallet_reservations r ON r.message_id = m.id
     WHERE m.tenant_id = $1 AND m.system_otp = false AND m.system_notification = false
     ORDER BY m.device_key`,
    [tenantId],
  );
  return rows.map((r) => r.device_key);
}

export interface DeviceUsageSummary {
  device_key: string;
  label: string | null;
  total_messages: number;
  total_successful: number;
  total_failed_refunded: number;
  total_spend_idr: number;
  total_refunded_idr: number;
  api_count: number;
  auto_reply_count: number;
  ai_reply_count: number;
  last_activity: string | null;
}

export async function getUsageDeviceSummary(tenantId: string, dateFrom?: string, dateTo?: string): Promise<DeviceUsageSummary[]> {
  const conditions = ['m.tenant_id = $1', 'm.system_otp = false', 'm.system_notification = false'];
  const params: (string | number)[] = [tenantId];
  let idx = 2;
  if (dateFrom) {
    conditions.push(`m.created_at >= $${idx}::timestamptz`);
    params.push(dateFrom + 'T00:00:00Z');
    idx += 1;
  }
  if (dateTo) {
    conditions.push(`m.created_at < $${idx}::timestamptz`);
    params.push(dateTo + 'T24:00:00Z');
    idx += 1;
  }
  const where = conditions.join(' AND ');
  const { rows } = await pool.query<{
    device_key: string; label: string | null;
    total_messages: string; total_successful: string; total_failed_refunded: string;
    total_spend_idr: string; total_refunded_idr: string;
    api_count: string; auto_reply_count: string; ai_reply_count: string;
    last_activity: string | null;
  }>(
    `SELECT m.device_key,
            d.label,
            count(*)::int AS total_messages,
            count(*) FILTER (WHERE m.status IN ('sent','delivered','read'))::int AS total_successful,
            count(*) FILTER (WHERE r.state = 'released')::int AS total_failed_refunded,
            COALESCE(sum(r.amount_idr) FILTER (WHERE r.state = 'captured'), 0)::bigint AS total_spend_idr,
            COALESCE(sum(r.amount_idr) FILTER (WHERE r.state = 'released'), 0)::bigint AS total_refunded_idr,
            count(*) FILTER (WHERE r.billing_category = 'api')::int AS api_count,
            count(*) FILTER (WHERE r.billing_category = 'auto_reply')::int AS auto_reply_count,
            count(*) FILTER (WHERE r.billing_category = 'ai_reply')::int AS ai_reply_count,
            max(m.created_at) AS last_activity
     FROM messages m
     INNER JOIN message_wallet_reservations r ON r.message_id = m.id AND r.attempt_no = m.retry_count
     LEFT JOIN devices d ON d.device_key = m.device_key AND d.tenant_id = m.tenant_id
     WHERE ${where}
     GROUP BY m.device_key, d.label
     ORDER BY total_spend_idr DESC`,
    params,
  );
  return rows.map((r) => ({
    device_key: r.device_key,
    label: r.label,
    total_messages: Number(r.total_messages),
    total_successful: Number(r.total_successful),
    total_failed_refunded: Number(r.total_failed_refunded),
    total_spend_idr: Number(r.total_spend_idr),
    total_refunded_idr: Number(r.total_refunded_idr),
    api_count: Number(r.api_count),
    auto_reply_count: Number(r.auto_reply_count),
    ai_reply_count: Number(r.ai_reply_count),
    last_activity: r.last_activity,
  }));
}

// ---------------------------------------------------------------------------
// Wallet reconciliation: verify balance integrity
// ---------------------------------------------------------------------------

export interface ReconciliationResult {
  ok: boolean;
  account: { available_idr: number; lifetime_spent_idr: number; lifetime_messages_charged: number };
  ledger: { total_topups_idr: number; total_debits_idr: number; total_refunds_idr: number; total_vouchers_idr: number; computed_available_idr: number };
  reservations: { captured_total_idr: number; captured_count: number; released_total_idr: number; debited_total_idr: number };
  stale_debited: { count: number; total_idr: number };
  drifts: string[];
}

export async function reconcileWallet(tenantId: string): Promise<ReconciliationResult> {
  const [accountRow, ledgerRow, reservationRow] = await Promise.all([
    pool.query<{
      available_idr: number | string; lifetime_spent_idr: number | string; lifetime_messages_charged: number | string;
    }>('SELECT available_idr, lifetime_spent_idr, lifetime_messages_charged FROM wallet_accounts WHERE tenant_id=$1', [tenantId]),
    pool.query<{
      total_topups: number | string; total_debits: number | string; total_refunds: number | string; total_vouchers: number | string;
    }>(`SELECT
          COALESCE(sum(amount_idr) FILTER (WHERE event_type='topup'), 0)::bigint AS total_topups,
          COALESCE(sum(amount_idr) FILTER (WHERE event_type='adjustment' AND available_delta_idr < 0), 0)::bigint AS total_debits,
          COALESCE(sum(amount_idr) FILTER (WHERE event_type='adjustment' AND available_delta_idr > 0), 0)::bigint AS total_refunds,
          COALESCE(sum(amount_idr) FILTER (WHERE event_type='voucher'), 0)::bigint AS total_vouchers
        FROM wallet_ledger WHERE tenant_id=$1`, [tenantId]),
    pool.query<{
      captured_total: number | string; captured_count: number | string;
      released_total: number | string; debited_total: number | string;
    }>(`SELECT
          COALESCE(sum(amount_idr) FILTER (WHERE state='captured'), 0)::bigint AS captured_total,
          count(*) FILTER (WHERE state='captured')::int AS captured_count,
          COALESCE(sum(amount_idr) FILTER (WHERE state='released'), 0)::bigint AS released_total,
          COALESCE(sum(amount_idr) FILTER (WHERE state='debited'), 0)::bigint AS debited_total
        FROM message_wallet_reservations WHERE tenant_id=$1`, [tenantId]),
  ]);

  const acct = accountRow.rows[0];
  if (!acct) {
    return {
      ok: true,
      account: { available_idr: 0, lifetime_spent_idr: 0, lifetime_messages_charged: 0 },
      ledger: { total_topups_idr: 0, total_debits_idr: 0, total_refunds_idr: 0, total_vouchers_idr: 0, computed_available_idr: 0 },
      reservations: { captured_total_idr: 0, captured_count: 0, released_total_idr: 0, debited_total_idr: 0 },
      stale_debited: { count: 0, total_idr: 0 },
      drifts: [],
    };
  }

  const available = idr(acct.available_idr);
  const lifetimeSpent = idr(acct.lifetime_spent_idr);
  const lifetimeCharged = Number(acct.lifetime_messages_charged);

  const lg = ledgerRow.rows[0]!;
  const topups = Number(lg.total_topups);
  const debits = Number(lg.total_debits);
  const refunds = Number(lg.total_refunds);
  const vouchers = Number(lg.total_vouchers);
  const computedAvailable = topups + vouchers - debits + refunds;

  const rv = reservationRow.rows[0]!;
  const capturedTotal = Number(rv.captured_total);
  const capturedCount = Number(rv.captured_count);
  const releasedTotal = Number(rv.released_total);
  const debitedTotal = Number(rv.debited_total);

  const drifts: string[] = [];

  if (available !== computedAvailable) {
    drifts.push(`Saldo tercatat ${available} != ledger ${computedAvailable} (selisih ${available - computedAvailable})`);
  }
  if (lifetimeSpent !== capturedTotal) {
    drifts.push(`lifetime_spent ${lifetimeSpent} != captured reservations ${capturedTotal} (selisih ${lifetimeSpent - capturedTotal})`);
  }
  if (lifetimeCharged !== capturedCount) {
    drifts.push(`lifetime_messages_charged ${lifetimeCharged} != captured count ${capturedCount} (selisih ${lifetimeCharged - capturedCount})`);
  }

  const staleRow = await pool.query<{ stale_count: number | string; stale_total_idr: number | string }>(
    `SELECT count(*)::int AS stale_count, COALESCE(sum(r.amount_idr), 0)::bigint AS stale_total_idr
     FROM message_wallet_reservations r
     JOIN messages m ON m.id = r.message_id
     WHERE r.tenant_id = $1 AND r.state = 'debited'
       AND m.status IN ('failed', 'blocked') AND COALESCE(m.error_message, '') <> 'delivery_uncertain'`,
    [tenantId],
  );
  const staleCount = Number(staleRow.rows[0]?.stale_count ?? 0);
  const staleTotalIdr = Number(staleRow.rows[0]?.stale_total_idr ?? 0);
  if (staleCount > 0) {
    drifts.push(`${staleCount} reservasi masih 'debited' meski pesan sudah gagal pasti (total ${staleTotalIdr} IDR belum dikembalikan)`);
  }

  return {
    ok: drifts.length === 0,
    account: { available_idr: available, lifetime_spent_idr: lifetimeSpent, lifetime_messages_charged: lifetimeCharged },
    ledger: { total_topups_idr: topups, total_debits_idr: debits, total_refunds_idr: refunds, total_vouchers_idr: vouchers, computed_available_idr: computedAvailable },
    reservations: { captured_total_idr: capturedTotal, captured_count: capturedCount, released_total_idr: releasedTotal, debited_total_idr: debitedTotal },
    stale_debited: { count: staleCount, total_idr: staleTotalIdr },
    drifts,
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
