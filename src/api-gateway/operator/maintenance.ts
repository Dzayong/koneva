import type { Pool } from 'pg';

/**
 * Housekeeping for operator tables. Deliberately does NOT touch operator_audit or operator_security_events (financial and
 * security history: deleting them is a retention decision for the owner, never automatic), invoices or student_requests.
 *
 * Idempotency rows: replay is promised for at least 72 hours; the default retention is 7 days. After that a retry with the
 * same key is processed as a NEW request. That is safe because every mutation also checks state and version under lock:
 * a payment for an invoice that is already paid answers 409 INVOICE_NOT_PAYABLE, a decision on an already decided
 * request answers 409 REQUEST_NOT_PENDING. No second effect, only no stored replay.
 */
export const IDEMPOTENCY_MIN_DAYS = 3;
export const IDEMPOTENCY_DEFAULT_DAYS = 7;

export function idempotencyRetentionDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['OPERATOR_IDEMPOTENCY_RETENTION_DAYS'];
  if (raw === undefined || raw === '') return IDEMPOTENCY_DEFAULT_DAYS;
  const days = Number(raw);
  if (!Number.isInteger(days) || days < IDEMPOTENCY_MIN_DAYS || days > 365) {
    throw new Error(`OPERATOR_IDEMPOTENCY_RETENTION_DAYS must be an integer from ${IDEMPOTENCY_MIN_DAYS} (the 72-hour replay promise) to 365`);
  }
  return days;
}

export interface CleanupResult { sessions: number; challenges: number; login_buckets: number; idempotency: number }

export async function cleanupOperatorData(db: Pool, retentionDays: number = idempotencyRetentionDays()): Promise<CleanupResult> {
  if (!Number.isInteger(retentionDays) || retentionDays < IDEMPOTENCY_MIN_DAYS) throw new Error('retention below the 72-hour replay promise');
  const count = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rowCount ?? 0;
  return {
    // Ended (revoked/expired) at least a day ago: the row no longer authorises anything.
    sessions: await count(`DELETE FROM operator_sessions WHERE
      (revoked_at IS NOT NULL AND revoked_at < now() - interval '1 day')
      OR absolute_expires_at < now() - interval '1 day' OR idle_expires_at < now() - interval '1 day'`),
    challenges: await count(`DELETE FROM operator_challenges WHERE expires_at < now() - interval '1 day' OR consumed_at < now() - interval '1 day'`),
    login_buckets: await count('DELETE FROM operator_login_attempts WHERE expires_at < now()'),
    idempotency: await count("DELETE FROM operator_idempotency WHERE created_at < now() - make_interval(days => $1)", [retentionDays]),
  };
}
