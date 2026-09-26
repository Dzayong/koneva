import type { WAMessageKey } from '@whiskeysockets/baileys';
import type { Logger } from 'winston';

type QueryFn = (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

export interface ReceiptUpdate {
  key: WAMessageKey;
  receipt: { userJid?: string | null; readTimestamp?: unknown; playedTimestamp?: unknown };
}

const viewerOf = (jid: string): string => {
  const [user = '', domain = ''] = jid.split('@');
  const digits = user.split(':')[0] ?? user;
  // A @lid identifier is not a phone number; keep it distinguishable so it is never shown as one.
  return domain === 'lid' ? `lid:${digits}` : digits;
};

/**
 * WhatsApp answers a Status we posted with a receipt per person who opened it (only when that person has
 * "read receipts" on). Records one row per viewer; repeated receipts change nothing.
 */
export async function recordStatusView(update: ReceiptUpdate, deviceKey: string, queryFn: QueryFn, log: Logger): Promise<boolean> {
  const { key, receipt } = update;
  if (key.remoteJid !== 'status@broadcast' || !key.fromMe || !key.id || !receipt.userJid) return false;
  if (!receipt.readTimestamp && !receipt.playedTimestamp) return false;
  const viewer = viewerOf(receipt.userJid);
  if (!viewer) return false;
  const inserted = await queryFn(
    `INSERT INTO status_views (device_id, status_message_id, viewer)
     SELECT id, $2::varchar, $3::varchar FROM devices WHERE device_key = $1
     ON CONFLICT DO NOTHING RETURNING viewer`,
    [deviceKey, key.id, viewer],
  );
  if (inserted.rows.length > 0) log.debug('Status viewed', { deviceKey, statusMessageId: key.id });
  return inserted.rows.length > 0;
}
