import type { Pool } from 'pg';
import { queueSystemNotification } from './message.service';
import { randomInt } from 'node:crypto';
import type { SystemNotificationType } from './system-notification-outbox';

export { recordSystemNotification } from './system-notification-outbox';

/** Queue due notifications at normal priority. OTPs remain on the separate urgent queue. */
export async function drainSystemNotificationOutbox(db: Pool, limit = 20): Promise<{ queued: number; deferred: number }> {
  const sender = (await db.query<{ tenant_id: string; device_key: string | null; status: string | null; recipient: string | null }>(
    `SELECT s.tenant_id,s.device_key,d.status,s.notification_recipient_phone AS recipient
     FROM system_whatsapp_otp_sender s LEFT JOIN devices d ON d.device_key=s.device_key AND d.tenant_id=s.tenant_id
     WHERE s.singleton=true AND s.notifications_enabled=true`,
  )).rows[0];
  if (!sender?.recipient || !sender.device_key || sender.status !== 'online') return { queued: 0, deferred: 0 };

  const events = (await db.query<{ id: string; event_type: SystemNotificationType; content: string }>(
    `SELECT id,event_type,content FROM system_notification_outbox
     WHERE queued_at IS NULL AND next_attempt_at <= now() AND attempts < 8
       AND (claimed_until IS NULL OR claimed_until <= now())
     ORDER BY created_at,id LIMIT $1`, [limit],
  )).rows;
  let queued = 0, deferred = 0;
  for (const event of events) {
    // Claim each row briefly; the message's deterministic external_id makes retry after a process crash safe.
    const claim = await db.query(
      `UPDATE system_notification_outbox SET attempts=attempts+1,claimed_until=now()+interval '1 minute'
       WHERE id=$1 AND queued_at IS NULL AND next_attempt_at <= now()
         AND (claimed_until IS NULL OR claimed_until <= now()) RETURNING id`, [event.id],
    );
    if (!claim.rowCount) continue;
    try {
      const delayMs = randomInt(5_000, 25_001); // dispatcher polls every 5 s; total target window remains ~5–30 s
      const message = await queueSystemNotification(sender.tenant_id, event.id, {
        device_key: sender.device_key, to: sender.recipient, message: event.content,
      }, delayMs);
      await db.query(
        `UPDATE system_notification_outbox SET queued_message_id=$2,queued_at=now(),claimed_until=NULL,last_error=NULL WHERE id=$1`,
        [event.id, message.id],
      );
      queued += 1;
    } catch (error) {
      const attempts = (await db.query<{ attempts: number }>('SELECT attempts FROM system_notification_outbox WHERE id=$1', [event.id])).rows[0]?.attempts ?? 1;
      const backoff = Math.min(15 * 60, 15 * 2 ** Math.min(attempts - 1, 6));
      await db.query(
        `UPDATE system_notification_outbox SET next_attempt_at=now()+make_interval(secs=>$2),claimed_until=NULL,last_error=$3 WHERE id=$1`,
        [event.id, backoff, error && typeof error === 'object' && 'code' in error ? String(error.code).slice(0, 120) : 'QUEUE_FAILED'],
      );
      deferred += 1;
    }
  }
  return { queued, deferred };
}
