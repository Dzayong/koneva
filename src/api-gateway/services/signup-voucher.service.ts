import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { creditSignupVoucherWithClient } from './wallet.service';
import { OperatorError, lockActor, operatorTransaction, writeAudit, type Actor } from '../operator/core';
import { ServiceError } from './service-error';

type Db = Pick<PoolClient, 'query'>;
const CODE_PATTERN = /^KONEVA-[A-F0-9]{16}$/;
const codeHash = (value: string): string => createHash('sha256').update(value).digest('hex');
const normalizeCode = (value: string): string => value.trim().toUpperCase().replace(/\s+/g, '');

export interface SignupVoucherSummary {
  id: string;
  code_hint: string;
  credit_idr: number;
  max_redemptions: number;
  redemptions_count: number;
  active: boolean;
  expires_at: Date | null;
  created_at: Date;
  disabled_at: Date | null;
}

/** Validate a supplied code during signup and return only its internal id for the pending account. */
export async function validateSignupVoucher(db: Db, rawCode: string | undefined): Promise<string | null> {
  if (!rawCode?.trim()) return null;
  const code = normalizeCode(rawCode);
  if (!CODE_PATTERN.test(code)) throw new ServiceError(400, 'VOUCHER_INVALID', 'Kode voucher tidak valid.');
  const row = (await db.query<QueryResultRow & {
    id: string; active: boolean; max_redemptions: number; redemptions_count: number; expires_at: Date | null;
  }>(
    `SELECT id,active,max_redemptions,redemptions_count,expires_at
     FROM signup_vouchers WHERE code_hash=$1`, [codeHash(code)],
  )).rows[0];
  if (!row) throw new ServiceError(400, 'VOUCHER_INVALID', 'Kode voucher tidak ditemukan.');
  if (!row.active || (row.expires_at && row.expires_at.getTime() <= Date.now()) || row.redemptions_count >= row.max_redemptions) {
    throw new ServiceError(409, 'VOUCHER_UNAVAILABLE', 'Voucher sudah kedaluwarsa atau kuotanya habis.');
  }
  return row.id;
}

/** Redeem in the signup activation transaction. Voucher lock, wallet credit, and account activation commit together. */
export async function redeemSignupVoucherForTenant(db: Db, userId: string, tenantId: string, voucherId: string | null): Promise<number> {
  if (!voucherId) return 0;
  const voucher = (await db.query<QueryResultRow & {
    id: string; credit_idr: number | string; max_redemptions: number; redemptions_count: number;
    active: boolean; expires_at: Date | null; code_suffix: string;
  }>(
    `SELECT id,credit_idr,max_redemptions,redemptions_count,active,expires_at,code_suffix
     FROM signup_vouchers WHERE id=$1 FOR UPDATE`, [voucherId],
  )).rows[0];
  if (!voucher || !voucher.active || (voucher.expires_at && voucher.expires_at.getTime() <= Date.now())) {
    throw new ServiceError(409, 'VOUCHER_UNAVAILABLE', 'Voucher sudah kedaluwarsa atau dinonaktifkan.');
  }
  if (voucher.redemptions_count >= voucher.max_redemptions) {
    throw new ServiceError(409, 'VOUCHER_EXHAUSTED', 'Kuota voucher sudah habis. Minta voucher lain kepada admin.');
  }
  const amount = Number(voucher.credit_idr);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100_000_000) {
    throw new ServiceError(503, 'VOUCHER_DATA_INVALID', 'Nominal voucher tidak valid.');
  }
  const redemptionId = randomUUID();
  const ledger = await creditSignupVoucherWithClient(db, tenantId, amount, `signup-voucher:${redemptionId}`, `VCH-${voucher.code_suffix}`);
  await db.query(
    `INSERT INTO signup_voucher_redemptions(id,voucher_id,user_id,tenant_id,credit_idr,wallet_ledger_id)
     VALUES($1,$2,$3,$4,$5,$6)`, [redemptionId, voucher.id, userId, tenantId, amount, ledger.id],
  );
  await db.query('UPDATE signup_vouchers SET redemptions_count=redemptions_count+1 WHERE id=$1', [voucher.id]);
  return amount;
}

export async function listSignupVouchers(db: Pool, actor: Actor, requestId: string, clientIp: string,
  limit: number, offset: number): Promise<{ items: SignupVoucherSummary[]; total: number }> {
  return operatorTransaction(db, async (client) => {
    await lockActor(client, actor, 'owner:insights', false);
    const total = Number((await client.query<{ total: string }>('SELECT count(*)::text AS total FROM signup_vouchers')).rows[0]?.total ?? 0);
    const rows = (await client.query<QueryResultRow & SignupVoucherSummary>(
      `SELECT id, 'KONEVA-••••••••••••'||code_suffix AS code_hint, credit_idr::int AS credit_idr, max_redemptions,
        redemptions_count, active, expires_at, created_at, disabled_at
       FROM signup_vouchers ORDER BY created_at DESC,id DESC LIMIT $1 OFFSET $2`, [limit, offset],
    )).rows;
    await writeAudit(client, actor, 'signup_voucher.list', 'signup_voucher', '00000000-0000-4000-8000-000000000003', 'Voucher signup', {}, requestId, clientIp);
    return { items: rows, total };
  });
}

export async function createSignupVoucher(db: Pool, actor: Actor, requestId: string, clientIp: string, input: {
  credit_idr: number; max_redemptions: number; expires_at: Date | null;
}) {
  if (input.expires_at && input.expires_at.getTime() <= Date.now()) {
    throw new OperatorError(400, 'VOUCHER_EXPIRY_INVALID', 'Masa berlaku voucher harus di waktu mendatang.');
  }
  const code = `KONEVA-${randomBytes(8).toString('hex').toUpperCase()}`;
  return operatorTransaction(db, async (client) => {
    await lockActor(client, actor, 'owner:insights', true);
    const voucher = (await client.query<QueryResultRow & SignupVoucherSummary>(
      `INSERT INTO signup_vouchers(code_hash,code_suffix,credit_idr,max_redemptions,expires_at,created_by)
       VALUES($1,$2,$3,$4,$5,$6)
       RETURNING id, 'KONEVA-••••••••••••'||code_suffix AS code_hint, credit_idr::int AS credit_idr,
         max_redemptions, redemptions_count, active, expires_at, created_at, disabled_at`,
      [codeHash(code), code.slice(-4), input.credit_idr, input.max_redemptions, input.expires_at, actor.id],
    )).rows[0]!;
    await writeAudit(client, actor, 'signup_voucher.create', 'signup_voucher', voucher.id, 'Voucher signup', {}, requestId, clientIp,
      `kredit=${input.credit_idr} IDR; kuota=${input.max_redemptions}`);
    return { ...voucher, code };
  });
}

export async function disableSignupVoucher(db: Pool, actor: Actor, voucherId: string, requestId: string, clientIp: string) {
  return operatorTransaction(db, async (client) => {
    await lockActor(client, actor, 'owner:insights', true);
    const voucher = (await client.query<QueryResultRow & { id: string; active: boolean }>(
      `UPDATE signup_vouchers SET active=false,disabled_at=COALESCE(disabled_at,now())
       WHERE id=$1 AND active=true RETURNING id,active`, [voucherId],
    )).rows[0];
    if (!voucher) throw new OperatorError(404, 'VOUCHER_NOT_FOUND', 'Voucher aktif tidak ditemukan.');
    await writeAudit(client, actor, 'signup_voucher.disable', 'signup_voucher', voucher.id, 'Voucher signup',
      { status: { from: 'active', to: 'disabled' } }, requestId, clientIp);
    return voucher;
  });
}
