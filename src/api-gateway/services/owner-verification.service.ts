import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import config from '../../shared/config';
import pool, { transaction } from '../../shared/database/connection';
import { requireEmail, sendInvitationOtp } from './mailer';
import { reserveIpRequest, reserveOtpSend } from './otp-limits';
import { ServiceError } from './service-error';

/**
 * Email verification for people who own a workspace (any email domain). It is required before inviting someone, changing the
 * team, or ordering/paying (see middleware/verified-email.ts); using devices and messaging is not affected. It uses the same mailer
 * and the same OTP limits as invitation OTPs. People who join through an invitation are verified by that invitation's OTP.
 */
export const VERIFY_MINUTES = 10;
export const VERIFY_MAX_ATTEMPTS = 5;
export const VERIFY_RESEND_SECONDS = 60;
const codeHash = (id: string, code: string): string => createHmac('sha256', config.jwt.secret).update(`email-verification-v1:${id}:${code}`).digest('hex');

export async function isEmailVerified(userId: string): Promise<boolean> {
  return Boolean((await pool.query<{ email_verified_at: Date | null }>('SELECT email_verified_at FROM users WHERE id = $1', [userId])).rows[0]?.email_verified_at);
}

export async function requestEmailVerification(userId: string, ip?: string): Promise<{ already_verified: true } | { sent: true; expires_in: number; resend_after: number }> {
  requireEmail(); // fail safe: nothing counted or stored while no sender is configured
  await reserveIpRequest(ip);
  const outcome = await transaction(async (client) => {
    const user = (await client.query<{ email: string; email_verified_at: Date | null }>('SELECT email, email_verified_at FROM users WHERE id = $1 FOR UPDATE', [userId])).rows[0];
    if (!user) throw new ServiceError(404, 'USER_NOT_FOUND', 'Akun tidak ditemukan.');
    if (user.email_verified_at) return { verified: true as const };
    const recent = (await client.query<{ last: number | null }>('SELECT extract(epoch FROM now() - max(created_at))::float AS last FROM email_verifications WHERE user_id = $1', [userId])).rows[0]!;
    if (recent.last !== null && recent.last < VERIFY_RESEND_SECONDS) {
      const wait = Math.ceil(VERIFY_RESEND_SECONDS - recent.last);
      throw new ServiceError(429, 'OTP_COOLDOWN', `Tunggu ${wait} detik sebelum meminta kode lagi.`, wait);
    }
    await reserveOtpSend({ email: user.email });
    await client.query('UPDATE email_verifications SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL', [userId]);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const id = randomUUID();
    await client.query(
      `INSERT INTO email_verifications (id, user_id, code_hash, expires_at) VALUES ($1, $2, $3, now() + make_interval(mins => $4))`, [id, userId, codeHash(id, code), VERIFY_MINUTES]);
    return { verified: false as const, id, email: user.email, code };
  });
  if (outcome.verified) return { already_verified: true };
  try {
    await sendInvitationOtp({ to: outcome.email, code: outcome.code, workspace: '', validMinutes: VERIFY_MINUTES, purpose: 'email-verification' });
  } catch (error) {
    await pool.query('UPDATE email_verifications SET consumed_at = now() WHERE id = $1', [outcome.id]);
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(502, 'EMAIL_SEND_FAILED', 'Kode verifikasi gagal dikirim. Coba lagi nanti.');
  }
  return { sent: true, expires_in: VERIFY_MINUTES * 60, resend_after: VERIFY_RESEND_SECONDS };
}

const CODE_INVALID = () => new ServiceError(422, 'OTP_INVALID', 'Kode salah, kedaluwarsa, atau sudah dipakai. Minta kode baru.') // not 401: the session itself is valid;

/**
 * One transaction: count the attempt, compare, and on a match consume the code AND set users.email_verified_at together. A wrong
 * guess still commits its attempt (the transaction ends normally and the refusal is raised afterwards), so guesses are never
 * rolled back into free retries; a failure while setting email_verified_at rolls the consumption back, the code stays usable.
 * Parallel confirms with the right code: one wins, the other re-checks consumed_at after the row lock and is refused.
 */
export async function confirmEmailVerification(userId: string, code: string): Promise<void> {
  const accepted = await transaction(async (client) => {
    const row = (await client.query<{ id: string; code_hash: string }>(
      `UPDATE email_verifications v SET attempts = v.attempts + 1
       WHERE v.id = (SELECT id FROM email_verifications WHERE user_id = $1 AND consumed_at IS NULL AND expires_at > now() AND attempts < $2
                     ORDER BY created_at DESC LIMIT 1)
         AND v.consumed_at IS NULL AND v.expires_at > now() AND v.attempts < $2
       RETURNING v.id, v.code_hash`, [userId, VERIFY_MAX_ATTEMPTS])).rows[0];
    if (!row) return false;
    const expected = Buffer.from(row.code_hash), given = Buffer.from(codeHash(row.id, code));
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false; // commit the attempt only
    const consumed = await client.query('UPDATE email_verifications SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL RETURNING id', [row.id]);
    if (!consumed.rowCount) return false;
    await client.query('UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1', [userId]);
    return true;
  });
  if (!accepted) throw CODE_INVALID();
}
