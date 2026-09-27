import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ServiceError } from '../services/service-error';

export class OperatorError extends ServiceError {
  constructor(status: number, code: string, message: string, public details?: Record<string, unknown>, retryAfter?: number) {
    super(status, code, message, retryAfter);
  }
}
export class AuditWriteError extends Error {}
export const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** A failed COMMIT is never advertised as a confirmed rollback. */
export async function operatorTransaction<T>(db: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  let committing = false;
  let broken = false;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query("SET LOCAL lock_timeout = '3s'");
    const result = await work(client);
    committing = true;
    await client.query('COMMIT');
    return result;
  } catch (error) {
    let rolledBack = false;
    try { await client.query('ROLLBACK'); rolledBack = true; } catch { broken = true; }
    if (committing || !rolledBack) {
      broken = true;
      throw new OperatorError(503, 'OUTCOME_UNKNOWN', 'Hasil belum pasti. Periksa status atau ulangi dengan kunci dan payload yang sama.');
    }
    if (error instanceof AuditWriteError) throw new OperatorError(500, 'AUDIT_FAILED', 'Pencatatan audit gagal; perubahan dibatalkan.', { rolled_back: true });
    throw error;
  } finally { client.release(broken); }
}

export interface Actor {
  id: string; name: string; email: string; permissions: string[]; tokenHash: string;
  authenticated_at: Date; idle_expires_at: Date; absolute_expires_at: Date;
}

/** Recheck identity and session under locks in the transaction that performs the mutation. */
export async function lockActor(client: PoolClient, actor: Actor, permission: string, recent: boolean): Promise<void> {
  const op = (await client.query<{ permissions: string[] }>(
    'SELECT permissions FROM operators WHERE id = $1 AND disabled_at IS NULL FOR SHARE', [actor.id],
  )).rows[0];
  if (!op) throw new OperatorError(403, 'NOT_OPERATOR', 'Akses operator tidak tersedia.');
  if (!op.permissions.includes(permission)) throw new OperatorError(403, 'FORBIDDEN', 'Izin tidak mencukupi.');
  const session = (await client.query<{ fresh: boolean }>(
    `SELECT authenticated_at > now() - interval '15 minutes' AS fresh FROM operator_sessions
     WHERE token_hash = $1 AND operator_id = $2 AND revoked_at IS NULL
       AND idle_expires_at > now() AND absolute_expires_at > now() FOR SHARE`, [actor.tokenHash, actor.id],
  )).rows[0];
  if (!session) throw new OperatorError(401, 'SESSION_EXPIRED', 'Sesi berakhir. Silakan masuk lagi.');
  if (recent && !session.fresh) throw new OperatorError(401, 'REAUTH_REQUIRED', 'Masuk kembali sebelum melakukan tindakan ini.');
}

export async function writeAudit(client: PoolClient, actor: Actor, action: string, targetType: string, targetId: string,
  label: string | null, changes: Record<string, { from: unknown; to: unknown }>, requestId: string): Promise<void> {
  // Only callers' explicit scalar status/method/version changes; never body, notes, email, or references.
  const allowed: Record<string, unknown> = {};
  for (const key of ['status', 'method', 'version']) if (changes[key]) allowed[key] = changes[key];
  try {
    await client.query(`INSERT INTO operator_audit (operator_id, action, target_type, target_id, target_label, changes, request_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`, [actor.id, action, targetType, targetId, label, JSON.stringify(allowed), requestId]);
  } catch { throw new AuditWriteError(); }
}

export async function idempotent<T>(db: Pool, actor: Actor, operation: string, targetId: string, key: string, payload: unknown,
  permission: string, work: (client: PoolClient) => Promise<T>): Promise<{ body: { success: true; data: T }; replay: boolean }> {
  return operatorTransaction(db, async (client) => {
    await lockActor(client, actor, permission, true);
    const scope = JSON.stringify([actor.id, operation, targetId, key]);
    const acquired = (await client.query<{ ok: boolean }>('SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS ok', [scope])).rows[0]?.ok;
    if (!acquired) throw new OperatorError(409, 'REQUEST_IN_PROGRESS', 'Permintaan masih diproses.', undefined, 2);
    const payloadHash = hash(canonicalJson(payload));
    const existing = (await client.query<{ payload_hash: string; response_body: { success: true; data: T } }>(
      `SELECT payload_hash, response_body FROM operator_idempotency WHERE operator_id=$1 AND operation=$2 AND target_id=$3 AND key=$4`,
      [actor.id, operation, targetId, key],
    )).rows[0];
    if (existing) {
      if (existing.payload_hash !== payloadHash) throw new OperatorError(409, 'IDEMPOTENCY_KEY_REUSED', 'Kunci sudah dipakai untuk payload berbeda.');
      return { body: existing.response_body, replay: true };
    }
    // Round trip dates before storage so the replay and first response have identical JSON values.
    const body = JSON.parse(JSON.stringify({ success: true, data: await work(client) })) as { success: true; data: T };
    await client.query(`INSERT INTO operator_idempotency (operator_id, operation, target_id, key, payload_hash, response_body)
      VALUES ($1,$2,$3,$4,$5,$6)`, [actor.id, operation, targetId, key, payloadHash, JSON.stringify(body)]);
    return { body, replay: false };
  });
}
