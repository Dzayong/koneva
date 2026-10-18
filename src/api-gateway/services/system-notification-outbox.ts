import type { Pool, PoolClient } from 'pg';

export type SystemNotificationType =
  | 'signup.created' | 'invoice.paid' | 'student.requested' | 'student.decided'
  | 'device.status_changed' | 'otp.threshold' | 'operator.break_glass';

/** Add a safe, already-rendered event to the durable outbox only when the owner enabled delivery. */
export async function recordSystemNotification(
  db: Pick<PoolClient, 'query'> | Pool,
  eventKey: string,
  eventType: SystemNotificationType,
  content: string,
): Promise<void> {
  const text = content.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000);
  if (!text) return;
  await db.query(
    `INSERT INTO system_notification_outbox(event_key,event_type,content)
     SELECT $1,$2,$3 WHERE EXISTS (
       SELECT 1 FROM system_whatsapp_otp_sender WHERE singleton=true AND notifications_enabled=true
         AND notification_recipient_phone IS NOT NULL)
     ON CONFLICT(event_key) DO NOTHING`, [eventKey.slice(0, 160), eventType, text],
  );
}
