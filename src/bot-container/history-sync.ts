import type { BaileysEventMap, WASocket, WAMessage } from '@whiskeysockets/baileys';
import type { Logger } from 'winston';
import type { QueryFn } from './health-score';

/** Return only a timestamp summary; never persist or log any part of message content. */
export function latestHistoryMessageAt(messages: readonly WAMessage[]): Date | null {
  let latest = 0;
  for (const message of messages) {
    const seconds = Number(message.messageTimestamp);
    if (Number.isFinite(seconds) && seconds > latest) latest = seconds;
  }
  return latest > 0 ? new Date(latest * 1_000) : null;
}

export function normalizeHistoryProgress(progress: number | null | undefined): number | null {
  if (progress == null || !Number.isFinite(progress)) return null;
  return Math.max(0, Math.min(100, Math.round(progress)));
}

export async function recordHistoryBatch(
  deviceKey: string,
  event: BaileysEventMap['messaging-history.set'],
  queryFn: QueryFn,
  log: Logger,
): Promise<void> {
  const latest = latestHistoryMessageAt(event.messages);
  const progress = normalizeHistoryProgress(event.progress);
  await queryFn(
    `UPDATE devices
     SET history_sync_status = 'syncing',
         history_sync_progress = CASE
           WHEN history_sync_status = 'completed' THEN $3::smallint
           ELSE COALESCE($3::smallint, history_sync_progress)
         END,
         history_sync_completion_explicit = FALSE,
         history_latest_message_at = CASE
           WHEN $2::timestamptz IS NULL THEN history_latest_message_at
           ELSE GREATEST(COALESCE(history_latest_message_at, $2::timestamptz), $2::timestamptz)
         END
     WHERE device_key = $1`,
    [deviceKey, latest, progress],
  );
  log.info('WhatsApp recent history sync batch processed', {
    deviceKey,
    messageCount: event.messages.length,
    progress,
    hasLatestMessageAt: latest !== null,
  });
}

export async function recordHistoryStatus(
  deviceKey: string,
  event: BaileysEventMap['messaging-history.status'],
  queryFn: QueryFn,
  log: Logger,
): Promise<void> {
  const completed = event.status === 'complete';
  await queryFn(
    `UPDATE devices
     SET history_sync_status = $2,
         history_sync_progress = CASE WHEN $2 = 'completed' AND $3::boolean THEN 100 ELSE history_sync_progress END,
         history_sync_completion_explicit = CASE WHEN $2 = 'completed' THEN $3::boolean ELSE history_sync_completion_explicit END,
         history_synced_at = CASE WHEN $2 = 'completed' THEN now() ELSE history_synced_at END
     WHERE device_key = $1`,
    [deviceKey, completed ? 'completed' : 'paused', event.explicit],
  );
  log.info('WhatsApp recent history sync status changed', {
    deviceKey,
    status: completed ? 'completed' : 'paused',
    completionConfirmedByServer: completed && event.explicit,
  });
}

export function registerHistorySyncListener(
  sock: WASocket,
  deviceKey: string,
  queryFn: QueryFn,
  log: Logger,
): void {
  sock.ev.on('messaging-history.set', (event) => {
    void recordHistoryBatch(deviceKey, event, queryFn, log).catch((error: unknown) => {
      log.warn('Unable to save WhatsApp history sync summary', {
        deviceKey,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });
  sock.ev.on('messaging-history.status', (event) => {
    void recordHistoryStatus(deviceKey, event, queryFn, log).catch((error: unknown) => {
      log.warn('Unable to save WhatsApp history sync status', {
        deviceKey,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });
}
