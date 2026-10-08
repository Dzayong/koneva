import type { Pool, PoolClient } from 'pg';
import logger from '../../shared/utils/logger';
import { hash } from './core';

export type SecurityEvent = 'login_success' | 'operator_provisioned' | 'break_glass_provisioned' | 'break_glass_login' | 'break_glass_alert_failed' | 'mfa_enrollment_started' | 'mfa_enrolled' | 'mfa_verified' | 'mfa_failed' | 'recovery_code_used' | 'mfa_reset' | 'mfa_key_rotated';
export type SecurityReason = 'challenge_invalid' | 'code_invalid' | 'recovery_code_invalid' | 'enrollment_code_invalid' | 'totp' | 'recovery_code';

export interface SecurityEventInput {
  event: SecurityEvent;
  operatorId?: string | null;
  reason?: SecurityReason;
  ip?: string | undefined;
  requestId?: string | undefined;
  source?: 'web' | 'offline';
  actorLabel?: string;
}

const SQL = `INSERT INTO operator_security_events (event, operator_id, source, reason, ip_hash, actor_label, request_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`;
const values = (e: SecurityEventInput) => [e.event, e.operatorId ?? null, e.source ?? 'web', e.reason ?? null,
  e.ip ? hash(`sec-ip:${e.ip}`) : null, e.actorLabel ?? null, e.requestId ?? null];

/** Inside a business transaction: the event commits or rolls back together with the state change it describes. */
export async function recordSecurityEventIn(client: PoolClient, event: SecurityEventInput): Promise<void> {
  await client.query(SQL, values(event));
}

/**
 * For failures: best effort. A failed insert is logged (without payload) and never changes the response the caller sees,
 * so a broken log cannot turn a rejected guess into a different, more informative error.
 */
export async function recordSecurityEvent(db: Pool, event: SecurityEventInput): Promise<void> {
  try { await db.query(SQL, values(event)); }
  catch (error) { logger.error('Operator security event could not be recorded', { event: event.event, error: error instanceof Error ? error.message : 'unknown' }); }
}
