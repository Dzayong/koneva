import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import config from '../../shared/config';
import pool, { transaction } from '../../shared/database/connection';
import { hashPassword } from './account.service';
import { requireEmail, sendNoticeEmail } from './mailer';
import { ServiceError } from './service-error';

/**
 * Self-service "forgot password". Uses the same mailer/transport as every other emailed code in this
 * codebase (fails safe with 503 while no sender is configured); tests must use EMAIL_TRANSPORT=dev-outbox,
 * never a real send. A successful reset revokes every existing session for that user — losing a password
 * is treated the same as a credential compromise.
 */
export const RESET_MINUTES = 30;
export const RESET_MAX_ATTEMPTS = 5;
export const RESET_RESEND_SECONDS = 60;
const codeHash = (id: string, code: string): string => createHmac('sha256', config.jwt.secret).update(`password-reset-v1:${id}:${code}`).digest('hex');

/** Always returns the same generic shape whether or not the address has an account, so this cannot be used to enumerate emails. */
export async function requestPasswordReset(email: string): Promise<{ sent: true; expires_in: number; resend_after: number }> {
  requireEmail(); // fail safe: nothing counted or stored while no sender is configured
  const outcome = await transaction(async (client) => {
    const user = (await client.query<{ id: string; email: string }>(
      `SELECT id, email FROM users WHERE lower(email) = lower($1) AND status = 'active' FOR UPDATE`, [email],
    )).rows[0];
    if (!user) return undefined;
    const recent = (await client.query<{ last: number | null }>(
      'SELECT extract(epoch FROM now() - max(created_at))::float AS last FROM password_reset_tokens WHERE user_id = $1', [user.id],
    )).rows[0]!;
    if (recent.last !== null && recent.last < RESET_RESEND_SECONDS) {
      const wait = Math.ceil(RESET_RESEND_SECONDS - recent.last);
      throw new ServiceError(429, 'OTP_COOLDOWN', `Tunggu ${wait} detik sebelum meminta kode lagi.`, wait);
    }
    await client.query('UPDATE password_reset_tokens SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL', [user.id]);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const id = randomUUID();
    await client.query(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
      [id, user.id, codeHash(id, code), RESET_MINUTES],
    );
    return { id, email: user.email, code };
  });
  if (outcome) {
    try {
      await sendNoticeEmail({
        to: outcome.email, subject: 'Kode reset kata sandi KONEVA',
        body: `Kode reset kata sandi Anda: ${outcome.code}\nKode berlaku ${RESET_MINUTES} menit.\nJika Anda tidak meminta ini, abaikan email ini; kata sandi Anda tidak berubah.`,
      });
    } catch (error) {
      await pool.query('UPDATE password_reset_tokens SET consumed_at = now() WHERE id = $1', [outcome.id]);
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(502, 'EMAIL_SEND_FAILED', 'Kode reset gagal dikirim. Coba lagi nanti.');
    }
  }
  return { sent: true, expires_in: RESET_MINUTES * 60, resend_after: RESET_RESEND_SECONDS };
}

const CODE_INVALID = () => new ServiceError(422, 'OTP_INVALID', 'Kode salah, kedaluwarsa, atau sudah dipakai. Minta kode baru.');

/** One transaction: count the attempt, compare, and on a match consume the code AND set the new password hash together. */
export async function confirmPasswordReset(email: string, code: string, newPassword: string): Promise<void> {
  const passwordHash = await hashPassword(newPassword);
  const accepted = await transaction(async (client) => {
    const user = (await client.query<{ id: string }>(`SELECT id FROM users WHERE lower(email) = lower($1) AND status = 'active'`, [email])).rows[0];
    if (!user) return false;
    const row = (await client.query<{ id: string; token_hash: string }>(
      `UPDATE password_reset_tokens t SET attempts = t.attempts + 1
       WHERE t.id = (SELECT id FROM password_reset_tokens WHERE user_id = $1 AND consumed_at IS NULL AND expires_at > now() AND attempts < $2
                     ORDER BY created_at DESC LIMIT 1)
         AND t.consumed_at IS NULL AND t.expires_at > now() AND t.attempts < $2
       RETURNING t.id, t.token_hash`, [user.id, RESET_MAX_ATTEMPTS],
    )).rows[0];
    if (!row) return false;
    const expected = Buffer.from(row.token_hash), given = Buffer.from(codeHash(row.id, code));
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
    const consumed = await client.query('UPDATE password_reset_tokens SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL RETURNING id', [row.id]);
    if (!consumed.rowCount) return false;
    await client.query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, passwordHash]);
    await client.query('UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [user.id]);
    return true;
  });
  if (!accepted) throw CODE_INVALID();
}
