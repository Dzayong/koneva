import type { Pool } from 'pg';
import logger from '../../shared/utils/logger';

/**
 * Housekeeping for the OTP tables. It runs whether or not the operator panel is enabled (the OTP features belong to customers).
 *
 * Retention (why these numbers):
 *  - invitation_otps and email_verifications: a code is useless once it is expired or consumed, and nothing reads it after that.
 *    Rows are kept one day past expiry/consumption (to explain "my code did not work" in support, they hold only a keyed hash and counts),
 *    then deleted. Live codes are never touched. Deleting old invitation_otps cannot weaken the 60 s pause (uses created_at within a
 *    minute) or the per-invitation hourly limit (counted in otp_rate_events).
 *  - otp_rate_events: the longest window is 24 h, so two days is enough; older counters are deleted.
 *  - otp_threshold_events (counts only, one or two rows a day at most) are kept; their retention is an owner decision.
 *  - operator_audit / operator_security_events / invoices etc. are never touched here.
 */
export interface OtpCleanupResult { otp_events: number; invitation_otps: number; email_verifications: number }

export async function cleanupOtpData(db: Pool): Promise<OtpCleanupResult> {
  const count = async (sql: string) => (await db.query(sql)).rowCount ?? 0;
  return {
    otp_events: await count("DELETE FROM otp_rate_events WHERE at < now() - interval '2 days'"),
    invitation_otps: await count("DELETE FROM invitation_otps WHERE expires_at < now() - interval '1 day' OR consumed_at < now() - interval '1 day'"),
    email_verifications: await count("DELETE FROM email_verifications WHERE expires_at < now() - interval '1 day' OR consumed_at < now() - interval '1 day'"),
  };
}

/** Hourly schedule (timers do not keep the process alive). Returns a stop function; delays are parameters so tests can use short ones. */
export function startOtpMaintenance(db: Pool, options: { firstDelayMs?: number; intervalMs?: number } = {}): () => void {
  const run = (): void => {
    cleanupOtpData(db)
      .then((counts) => { if (Object.values(counts).some((n) => n > 0)) logger.info('OTP data cleaned', counts); })
      .catch((error: unknown) => logger.error('OTP cleanup failed', { error: error instanceof Error ? error.message : String(error) }));
  };
  const first = setTimeout(run, options.firstDelayMs ?? 90_000); first.unref();
  const every = setInterval(run, options.intervalMs ?? 60 * 60_000); every.unref();
  return () => { clearTimeout(first); clearInterval(every); };
}
