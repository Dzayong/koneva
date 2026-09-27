import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Request, Response, CookieOptions } from 'express';
import type { Pool } from 'pg';
import type { OperatorConfig } from './config';
import { hash, operatorTransaction, OperatorError, type Actor } from './core';
import logger from '../../shared/utils/logger';
import { recordSecurityEventIn, recordSecurityEvent } from './security-events';
import { codeHash, decryptSecret, encryptSecret, newRecoveryCodes, newSecret, otpauthUri, sameCodeHash, verifyTotp } from './mfa';

const requestIdOf = (request: Request): string | undefined => {
  const id = (request.res?.locals as Record<string, unknown> | undefined)?.['requestId'];
  return typeof id === 'string' ? id : undefined;
};
/** Records a rejected MFA step (never the submitted value) and lets the original error through unchanged. */
async function failing(db: Pool, request: Request, operatorId: string | null, reasonFor: (code: string) => 'challenge_invalid' | 'code_invalid' | 'recovery_code_invalid' | 'enrollment_code_invalid' | null, error: unknown): Promise<never> {
  if (error instanceof OperatorError) {
    const reason = reasonFor(error.code);
    if (reason) await recordSecurityEvent(db, { event: 'mfa_failed', operatorId, reason, ip: request.ip, requestId: requestIdOf(request) });
  }
  throw error;
}

/**
 * A ciphertext that does not open with the configured key means the key is wrong or lost (or the data was tampered with).
 * That is an operational fault, not a wrong guess: refuse without creating a session and without saying why to the caller.
 */
export function openSecret(key: Buffer, stored: string, operatorId: string): Buffer {
  try { return decryptSecret(key, stored, operatorId); }
  catch {
    logger.error('Operator MFA secret cannot be decrypted with the configured key; check OPERATOR_MFA_ENC_KEY (docs/OPERATOR_PANEL.md)');
    throw new OperatorError(503, 'MFA_UNAVAILABLE', 'Verifikasi dua langkah sedang tidak tersedia. Hubungi administrator.');
  }
}

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

const MAX_CHALLENGE_ATTEMPTS = 5;
const challengeInvalid = () => new OperatorError(401, 'MFA_CHALLENGE_INVALID', 'Verifikasi berakhir. Silakan masuk lagi.');
const mfaInvalid = () => new OperatorError(401, 'MFA_INVALID', 'Kode verifikasi salah atau sudah dipakai.');

interface ChallengeRow { operator_id: string; purpose: 'verify' | 'enroll'; pending_secret_enc: string | null; enrollment_code_ok: boolean; attempts: number }

/**
 * Counts an attempt in its own committed statement BEFORE anything is verified, so a failed guess can never be rolled
 * back into a free retry. Unknown, expired, consumed and exhausted challenges are indistinguishable to the caller.
 */
async function spendAttempt(db: Pool, challengeId: string, purpose: 'verify' | 'enroll'): Promise<ChallengeRow> {
  const row = (await db.query<ChallengeRow>(
    `UPDATE operator_challenges SET attempts=attempts+1
     WHERE token_hash=$1 AND purpose=$2 AND consumed_at IS NULL AND expires_at > now() AND attempts < $3
     RETURNING operator_id, purpose, pending_secret_enc, enrollment_code_ok, attempts`, [hash(challengeId), purpose, MAX_CHALLENGE_ATTEMPTS],
  )).rows[0];
  if (!row) throw challengeInvalid();
  return row;
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

/** Step 1: password. Never creates a session; returns a short-lived challenge that must be completed with MFA. */
export async function login(db: Pool, _config: OperatorConfig, request: Request, _response: Response, input: { email: string; password: string }) {
  await reserveLoginAttempt(db, input.email, request.ip ?? 'unknown');
  const account = (await db.query<{ id: string; password_hash: string; disabled_at: Date | null; mfa_enrolled_at: Date | null }>(
    'SELECT id, password_hash, disabled_at, mfa_enrolled_at FROM operators WHERE email=$1', [input.email],
  )).rows[0];
  const valid = await bcrypt.compare(input.password, account?.password_hash ?? DUMMY_HASH);
  if (!account || !valid || account.disabled_at) throw new OperatorError(401, 'INVALID_CREDENTIALS', 'Email atau kata sandi salah.');
  const challenge = randomBytes(32).toString('hex');
  const purpose = account.mfa_enrolled_at ? 'verify' : 'enroll';
  await operatorTransaction(db, async (client) => {
    const current = (await client.query<{ password_hash: string }>(
      'SELECT password_hash FROM operators WHERE id=$1 AND disabled_at IS NULL FOR SHARE', [account.id],
    )).rows[0];
    if (!current || current.password_hash !== account.password_hash) throw new OperatorError(401, 'INVALID_CREDENTIALS', 'Email atau kata sandi salah.');
    await client.query('UPDATE operator_challenges SET consumed_at=now() WHERE operator_id=$1 AND consumed_at IS NULL', [account.id]);
    await client.query('INSERT INTO operator_challenges (token_hash, operator_id, purpose) VALUES ($1,$2,$3)', [hash(challenge), account.id, purpose]);
  });
  return { status: purpose === 'verify' ? 'mfa_required' : 'mfa_enrollment_required', challenge_id: challenge, expires_in: 300 };
}

/** Step 2 (enrolled): a current TOTP code, or a single-use recovery code. */
export async function verifyMfa(db: Pool, config: OperatorConfig, request: Request, response: Response,
  input: { challenge_id: string; code?: string | undefined; recovery_code?: string | undefined }) {
  await reserveBucket(db, 'mfa-ip', request.ip ?? 'unknown', 30);
  let operatorId: string | null = null;
  try {
  const challenge = await spendAttempt(db, input.challenge_id, 'verify');
  operatorId = challenge.operator_id;
  await reserveBucket(db, 'mfa', challenge.operator_id, 10);
  const operator = (await db.query<{ mfa_secret_enc: string | null; disabled_at: Date | null }>(
    'SELECT mfa_secret_enc, disabled_at FROM operators WHERE id=$1', [challenge.operator_id])).rows[0];
  if (!operator?.mfa_secret_enc || operator.disabled_at) throw challengeInvalid();
  if (input.code !== undefined) {
    const step = verifyTotp(openSecret(config.mfaKey!, operator.mfa_secret_enc, challenge.operator_id), input.code);
    if (step === null) throw mfaInvalid();
    // A code can be used once: only a strictly newer time step is accepted, atomically.
    const fresh = await db.query('UPDATE operators SET mfa_last_step=$2 WHERE id=$1 AND (mfa_last_step IS NULL OR mfa_last_step < $2) RETURNING id', [challenge.operator_id, step]);
    if (!fresh.rowCount) throw mfaInvalid();
  } else {
    const used = await db.query('UPDATE operator_recovery_codes SET used_at=now() WHERE operator_id=$1 AND code_hash=$2 AND used_at IS NULL RETURNING code_hash',
      [challenge.operator_id, codeHash(input.recovery_code ?? '')]);
    if (!used.rowCount) throw mfaInvalid();
  }
  const { actor, token } = await createSession(db, config, request, response, challenge.operator_id, async (client) => {
    await recordSecurityEventIn(client, { event: 'mfa_verified', operatorId: challenge.operator_id, reason: input.code !== undefined ? 'totp' : 'recovery_code', ip: request.ip, requestId: requestIdOf(request) });
    if (input.code === undefined) await recordSecurityEventIn(client, { event: 'recovery_code_used', operatorId: challenge.operator_id, reason: 'recovery_code', ip: request.ip, requestId: requestIdOf(request) });
    const consumed = await client.query('UPDATE operator_challenges SET consumed_at=now() WHERE token_hash=$1 AND consumed_at IS NULL RETURNING token_hash', [hash(input.challenge_id)]);
    if (!consumed.rowCount) throw challengeInvalid();
  });
  const remaining = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM operator_recovery_codes WHERE operator_id=$1 AND used_at IS NULL', [actor.id])).rows[0]!.n;
  return { status: 'authenticated', ...me(actor, token), recovery_codes_remaining: remaining };
  } catch (error) {
    return failing(db, request, operatorId, (code) => code === 'MFA_CHALLENGE_INVALID' ? 'challenge_invalid' : code === 'MFA_INVALID' ? (input.code !== undefined ? 'code_invalid' : 'recovery_code_invalid') : null, error);
  }
}

/** Enrollment step A: prove the out-of-band enrollment code, then receive a fresh TOTP secret to scan. */
export async function startEnrollment(db: Pool, config: OperatorConfig, request: Request,
  input: { challenge_id: string; enrollment_code?: string | undefined }) {
  await reserveBucket(db, 'mfa-ip', request.ip ?? 'unknown', 30);
  let operatorId: string | null = null;
  try {
  const challenge = await spendAttempt(db, input.challenge_id, 'enroll');
  operatorId = challenge.operator_id;
  await reserveBucket(db, 'mfa', challenge.operator_id, 10);
  const operator = (await db.query<{ email: string; mfa_enrolled_at: Date | null; disabled_at: Date | null; enrollment_code_hash: string | null; expired: boolean }>(
    `SELECT email, mfa_enrolled_at, disabled_at, enrollment_code_hash, (enrollment_code_expires_at IS NULL OR enrollment_code_expires_at <= now()) AS expired
     FROM operators WHERE id=$1`, [challenge.operator_id])).rows[0];
  if (!operator || operator.disabled_at || operator.mfa_enrolled_at) throw challengeInvalid();
  if (!challenge.enrollment_code_ok) {
    if (!input.enrollment_code || !operator.enrollment_code_hash || operator.expired
      || !sameCodeHash(operator.enrollment_code_hash, codeHash(input.enrollment_code))) {
      throw new OperatorError(401, 'ENROLLMENT_CODE_INVALID', 'Kode pendaftaran salah atau kedaluwarsa.');
    }
  }
  const secret = newSecret();
  await db.query('UPDATE operator_challenges SET pending_secret_enc=$2, enrollment_code_ok=true WHERE token_hash=$1',
    [hash(input.challenge_id), encryptSecret(config.mfaKey!, secret.bytes, challenge.operator_id)]);
  await recordSecurityEvent(db, { event: 'mfa_enrollment_started', operatorId, ip: request.ip, requestId: requestIdOf(request) });
  return { secret: secret.base32, otpauth_uri: otpauthUri(secret.base32, operator.email) };
  } catch (error) {
    return failing(db, request, operatorId, (code) => code === 'MFA_CHALLENGE_INVALID' ? 'challenge_invalid' : code === 'ENROLLMENT_CODE_INVALID' ? 'enrollment_code_invalid' : null, error);
  }
}

/** Enrollment step B: a code from the new authenticator activates MFA, issues recovery codes once, and creates the session. */
export async function confirmEnrollment(db: Pool, config: OperatorConfig, request: Request, response: Response,
  input: { challenge_id: string; code: string }) {
  await reserveBucket(db, 'mfa-ip', request.ip ?? 'unknown', 30);
  let operatorId: string | null = null;
  try {
  const challenge = await spendAttempt(db, input.challenge_id, 'enroll');
  operatorId = challenge.operator_id;
  await reserveBucket(db, 'mfa', challenge.operator_id, 10);
  if (!challenge.enrollment_code_ok || !challenge.pending_secret_enc) throw challengeInvalid();
  const secretBytes = openSecret(config.mfaKey!, challenge.pending_secret_enc, challenge.operator_id);
  const step = verifyTotp(secretBytes, input.code);
  if (step === null) throw mfaInvalid();
  const recoveryCodes = newRecoveryCodes();
  const { actor, token } = await createSession(db, config, request, response, challenge.operator_id, async (client) => {
    // Consume the challenge first: the credential trigger below also closes any other open challenge.
    const consumed = await client.query('UPDATE operator_challenges SET consumed_at=now() WHERE token_hash=$1 AND consumed_at IS NULL RETURNING token_hash', [hash(input.challenge_id)]);
    if (!consumed.rowCount) throw challengeInvalid();
    await recordSecurityEventIn(client, { event: 'mfa_enrolled', operatorId: challenge.operator_id, ip: request.ip, requestId: requestIdOf(request) });
    const activated = await client.query(
      `UPDATE operators SET mfa_secret_enc=$2, mfa_enrolled_at=now(), mfa_last_step=$3, enrollment_code_hash=NULL, enrollment_code_expires_at=NULL
       WHERE id=$1 AND mfa_enrolled_at IS NULL AND disabled_at IS NULL RETURNING id`,
      [challenge.operator_id, encryptSecret(config.mfaKey!, secretBytes, challenge.operator_id), step]);
    if (!activated.rowCount) throw challengeInvalid();
    await client.query('DELETE FROM operator_recovery_codes WHERE operator_id=$1', [challenge.operator_id]);
    for (const code of recoveryCodes) await client.query('INSERT INTO operator_recovery_codes (operator_id, code_hash) VALUES ($1,$2)', [challenge.operator_id, codeHash(code)]);
  });
  return { status: 'authenticated', ...me(actor, token), recovery_codes: recoveryCodes, recovery_codes_remaining: recoveryCodes.length };
  } catch (error) {
    return failing(db, request, operatorId, (code) => code === 'MFA_CHALLENGE_INVALID' ? 'challenge_invalid' : code === 'MFA_INVALID' ? 'code_invalid' : null, error);
  }
}
