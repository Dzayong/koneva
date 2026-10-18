import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Request, Response, CookieOptions } from 'express';
import type { Pool } from 'pg';
import type { OperatorConfig } from './config';
import { hash, operatorTransaction, OperatorError, type Actor } from './core';
import logger from '../../shared/utils/logger';
import { sendNoticeEmail } from '../services/mailer';
import { recordSecurityEventIn, recordSecurityEvent } from './security-events';
import { recordSystemNotification } from '../services/system-notification-outbox';

const requestIdOf = (request: Request): string | undefined => {
  const id = (request.res?.locals as Record<string, unknown> | undefined)?.['requestId'];
  return typeof id === 'string' ? id : undefined;
};

const DUMMY_HASH = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxJrO.rSeR.CAubtbjdCKSByPK.';
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
export const csrfFor = (token: string): string => createHmac('sha256', token).update('koneva-operator-csrf-v1').digest('hex');
export function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function sessionToken(request: Request, config: OperatorConfig): string | undefined {
  const values = (request.headers.cookie ?? '').split(';').map((p) => p.trim()).filter((p) => p.startsWith(`${config.cookieName}=`));
  if (values.length !== 1) return undefined;
  const token = values[0]!.slice(config.cookieName.length + 1);
  return TOKEN_PATTERN.test(token) ? token : undefined;
}
const cookieOptions = (config: OperatorConfig): CookieOptions => ({ httpOnly: true, secure: config.secure, sameSite: 'strict', path: '/' });
export function clearSessionCookie(response: Response, config: OperatorConfig): void { response.clearCookie(config.cookieName, cookieOptions(config)); }

export function checkOrigin(request: Request, config: OperatorConfig): void {
  if (request.get('Origin') !== config.origin || (request.get('Sec-Fetch-Site') && request.get('Sec-Fetch-Site') !== 'same-origin')) {
    throw new OperatorError(403, 'ORIGIN_NOT_ALLOWED', 'Origin tidak diizinkan.');
  }
}
export function checkCsrf(request: Request, token: string): void {
  const csrf = request.get('X-CSRF-Token') ?? '';
  if (!/^[a-f0-9]{64}$/.test(csrf) || !sameSecret(csrf, csrfFor(token))) throw new OperatorError(403, 'CSRF_INVALID', 'Token CSRF tidak valid.');
}

export async function authenticate(db: Pool, token: string | undefined): Promise<Actor> {
  if (!token) throw new OperatorError(401, 'UNAUTHENTICATED', 'Silakan masuk sebagai operator.');
  const tokenHash = hash(token);
  const row = (await db.query<Actor & { disabled_at: Date | null; valid: boolean }>(
    `SELECT o.id, o.name, o.email, o.permissions, o.disabled_at, s.authenticated_at, s.idle_expires_at, s.absolute_expires_at,
      (s.revoked_at IS NULL AND s.idle_expires_at > now() AND s.absolute_expires_at > now()) AS valid
     FROM operator_sessions s JOIN operators o ON o.id=s.operator_id WHERE s.token_hash=$1`, [tokenHash],
  )).rows[0];
  if (!row || !row.valid) throw new OperatorError(401, 'SESSION_EXPIRED', 'Sesi berakhir. Silakan masuk lagi.');
  if (row.disabled_at) throw new OperatorError(403, 'NOT_OPERATOR', 'Akses operator dinonaktifkan.');
  const touched = (await db.query<{ idle_expires_at: Date }>(
    `UPDATE operator_sessions SET touched_at=now(), idle_expires_at=LEAST(absolute_expires_at, now() + interval '30 minutes')
     WHERE token_hash=$1 AND touched_at <= now() - interval '1 minute'
       AND revoked_at IS NULL AND idle_expires_at > now() AND absolute_expires_at > now() RETURNING idle_expires_at`, [tokenHash],
  )).rows[0];
  return { id: row.id, name: row.name, email: row.email, permissions: row.permissions, tokenHash,
    authenticated_at: row.authenticated_at, idle_expires_at: touched?.idle_expires_at ?? row.idle_expires_at, absolute_expires_at: row.absolute_expires_at };
}
export function me(actor: Actor, token: string) {
  return { operator: { id: actor.id, name: actor.name, email: actor.email }, permissions: actor.permissions,
    csrf_token: csrfFor(token), session: { idle_expires_at: actor.idle_expires_at, absolute_expires_at: actor.absolute_expires_at } };
}

/** Persistent buckets across API workers; stores neither raw email nor IP. Counts attempts before the expensive check. */
export async function reserveBucket(db: Pool, kind: string, value: string, limit: number): Promise<void> {
  const row = (await db.query<{ attempts: number; retry: number }>(
    `INSERT INTO operator_login_attempts (bucket, attempts, expires_at) VALUES ($1, 1, now()+interval '15 minutes')
     ON CONFLICT (bucket) DO UPDATE SET
       attempts=CASE WHEN operator_login_attempts.expires_at <= now() THEN 1 ELSE operator_login_attempts.attempts+1 END,
       expires_at=CASE WHEN operator_login_attempts.expires_at <= now() THEN now()+interval '15 minutes' ELSE operator_login_attempts.expires_at END
     RETURNING attempts, GREATEST(1,ceil(extract(epoch FROM expires_at-now())))::int AS retry`, [hash(`${kind}:${value}`)],
  )).rows[0]!;
  if (row.attempts > limit) throw new OperatorError(429, 'RATE_LIMITED', 'Terlalu banyak percobaan. Coba lagi nanti.', undefined, row.retry);
}
export async function reserveLoginAttempt(db: Pool, email: string, ip: string): Promise<void> {
  await reserveBucket(db, 'ip', ip, 30);
  await reserveBucket(db, 'email', email, 5);
}

async function alertBreakGlassUse(db: Pool, request: Request, operatorId: string, operatorName: string): Promise<void> {
  const recipient = process.env['OPERATOR_BREAK_GLASS_ALERT_EMAIL'] ?? '';
  const sourceIp = (request.ip ?? 'unknown').replace(/[^0-9a-f:.]/gi, '').slice(0, 64) || 'unknown';
  try {
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient)) throw new Error('Alert recipient is missing or invalid.');
    await sendNoticeEmail({
      to: recipient,
      subject: 'KONEVA: akun Operator darurat digunakan',
      body: `Akun Operator darurat berhasil masuk.\nNama akun: ${operatorName.replace(/[\r\n\x00-\x1f\x7f]/g, ' ').slice(0, 120)}\nWaktu UTC: ${new Date().toISOString()}\nAlamat IP sumber: ${sourceIp}\n\nJika penggunaan ini tidak Anda kenali, nonaktifkan akun darurat melalui prosedur offline dan tinjau audit Operator.`,
    });
  } catch (error) {
    await recordSecurityEvent(db, { event: 'break_glass_alert_failed', operatorId, ip: request.ip, requestId: requestIdOf(request) });
    logger.error('Break-glass login refused because owner alert could not be sent', { error: error instanceof Error ? error.message : 'unknown' });
    throw new OperatorError(503, 'BREAK_GLASS_ALERT_FAILED', 'Login akun darurat ditahan karena notifikasi keamanan belum terkirim.');
  }
}

/** The single place a full operator session is born. Rotates the old cookie session, sets the cookie. */
async function createSession(db: Pool, config: OperatorConfig, request: Request, response: Response, operatorId: string,
  inTransaction: (client: import('pg').PoolClient) => Promise<void>) {
  const token = randomBytes(32).toString('hex');
  const oldToken = sessionToken(request, config);
  await operatorTransaction(db, async (client) => {
    const current = (await client.query('SELECT 1 FROM operators WHERE id=$1 AND disabled_at IS NULL FOR SHARE', [operatorId])).rows[0];
    if (!current) throw new OperatorError(401, 'INVALID_CREDENTIALS', 'Email atau kata sandi salah.');
    await inTransaction(client);
    if (oldToken) await client.query('UPDATE operator_sessions SET revoked_at=now() WHERE token_hash=$1', [hash(oldToken)]);
    await client.query('INSERT INTO operator_sessions (token_hash, operator_id) VALUES ($1,$2)', [hash(token), operatorId]);
  });
  const actor = await authenticate(db, token);
  response.cookie(config.cookieName, token, { ...cookieOptions(config), maxAge: 8 * 60 * 60_000 });
  return { actor, token };
}

/** Password login: validates credentials and creates a session directly. */
export async function login(db: Pool, config: OperatorConfig, request: Request, response: Response, input: { email: string; password: string }) {
  await reserveLoginAttempt(db, input.email, request.ip ?? 'unknown');
  const account = (await db.query<{ id: string; password_hash: string; disabled_at: Date | null; is_break_glass: boolean; name: string }>(
    'SELECT id, password_hash, disabled_at, is_break_glass, name FROM operators WHERE email=$1', [input.email],
  )).rows[0];
  const valid = await bcrypt.compare(input.password, account?.password_hash ?? DUMMY_HASH);
  if (!account || !valid || account.disabled_at) throw new OperatorError(401, 'INVALID_CREDENTIALS', 'Email atau kata sandi salah.');
  if (account.is_break_glass) await alertBreakGlassUse(db, request, account.id, account.name);
  const { actor, token } = await createSession(db, config, request, response, account.id, async (client) => {
    await recordSecurityEventIn(client, { event: 'login_success', operatorId: account.id, ip: request.ip, requestId: requestIdOf(request) });
    if (account.is_break_glass) {
      await client.query('UPDATE operators SET break_glass_validated_at=now() WHERE id=$1 AND is_break_glass', [account.id]);
      await recordSecurityEventIn(client, { event: 'break_glass_login', operatorId: account.id, ip: request.ip, requestId: requestIdOf(request) });
      await recordSystemNotification(client, `operator.break_glass:${requestIdOf(request) ?? randomUUID()}`, 'operator.break_glass',
        `Peringatan keamanan KONEVA: akun operator darurat ${account.name.replace(/[\r\n\x00-\x1f\x7f]/g, ' ').slice(0, 100)} berhasil masuk.`);
    }
  });
  return { status: 'authenticated' as const, ...me(actor, token) };
}
