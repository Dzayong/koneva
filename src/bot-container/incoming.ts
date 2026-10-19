import {
  normalizeMessageContent,
  type BaileysEventMap,
  type WASocket,
  type WAMessage,
  type WAMessageKey,
} from '@whiskeysockets/baileys';
import type { Logger } from 'winston';
import { query } from '../shared/database/connection';
import type { QueryFn } from './health-score';
import { dispatchWebhook, type WebhookPayload } from './webhook';
import pool, { transaction } from '../shared/database/connection';
import { normalizeRecipientNumber, parseConsentKeyword, withRecipientConsentLock } from '../shared/recipient-consent';

const defaultQueryFn: QueryFn = (text, params) => query(text, params);

function jidNumber(jid: string | null | undefined): string | undefined {
  return jid?.split('@')[0]?.split(':')[0] || undefined;
}

export function isIgnoredChat(jid: string | null | undefined): boolean {
  return !!jid && (jid.endsWith('@broadcast') || jid.endsWith('@newsletter'));
}

// Baileys' cleanMessage() rewrites a missing key.participant to '' (not
// undefined) on 1:1 chats, so `participant ?? remoteJid` yields '' and every
// direct message looked sender-less. Pick the field by chat type instead, and
// prefer the phone-number JID over an @lid one when Baileys supplies it.
export function resolveSenderNumber(key: WAMessageKey): string | undefined {
  const isGroup = key.remoteJid?.endsWith('@g.us') ?? false;
  const jid = isGroup ? key.participant : key.remoteJid;
  const alt = isGroup ? key.participantAlt : key.remoteJidAlt;
  return jidNumber(jid?.endsWith('@lid') && alt ? alt : jid);
}

export function incomingContent(message: WAMessage): {
  content: string;
  type: 'text' | 'image' | 'document' | 'video' | 'audio';
} {
  const content = normalizeMessageContent(message.message);
  if (content?.conversation) return { content: content.conversation, type: 'text' };
  if (content?.extendedTextMessage?.text) {
    return { content: content.extendedTextMessage.text, type: 'text' };
  }
  if (content?.imageMessage) {
    return { content: content.imageMessage.caption || '[Image]', type: 'image' };
  }
  if (content?.videoMessage) {
    return { content: content.videoMessage.caption || '[Video]', type: 'video' };
  }
  if (content?.audioMessage) return { content: '[Audio]', type: 'audio' };
  if (content?.documentMessage) {
    return { content: content.documentMessage.fileName || '[Document]', type: 'document' };
  }
  return { content: '[Unsupported message]', type: 'text' };
}

export async function handleIncomingMessage(
  message: WAMessage,
  deviceKey: string,
  queryFn: QueryFn,
  log: Logger,
  webhookDispatcher: typeof dispatchWebhook = dispatchWebhook,
  beforeWebhook?: (message: IncomingMessageRecord) => Promise<void>,
): Promise<IncomingMessageRecord | undefined> {
  if (message.key.fromMe || !message.key.id) {
    log.debug('Ignoring own or id-less WhatsApp message', { deviceKey, fromMe: message.key.fromMe });
    return;
  }

  const remoteJid = message.key.remoteJid;
  if (isIgnoredChat(remoteJid)) {
    log.debug('Ignoring broadcast/newsletter message', { deviceKey, remoteJid });
    return;
  }
  const fromNumber = resolveSenderNumber(message.key);
  if (!remoteJid || !fromNumber) {
    log.warn('Incoming WhatsApp message has no sender', {
      whatsappMessageId: message.key.id,
      key: message.key,
    });
    return;
  }

  const deviceResult = await queryFn(
    'SELECT id, tenant_id, phone_number FROM devices WHERE device_key = $1 LIMIT 1',
    [deviceKey],
  );
  const device = deviceResult.rows[0] as
    | { id: string; tenant_id: string; phone_number: string | null }
    | undefined;
  if (!device) {
    log.error('Unable to save incoming message: device not found', { deviceKey });
    return;
  }

  const parsed = incomingContent(message);
  const timestampSeconds = Number(message.messageTimestamp);
  const inserted = await queryFn(
    `INSERT INTO messages (
       tenant_id, device_id, device_key, from_number, to_number, chat_jid, content, type,
       status, direction, whatsapp_message_id, created_at
     )
     SELECT $1::uuid, $2::uuid, $3::varchar, $4::varchar, $5::varchar, $6::varchar, $7::text, $8::varchar,
            'received', 'inbound', $9::varchar,
            CASE WHEN $10::double precision > 0 THEN to_timestamp($10::double precision) ELSE now() END
     WHERE NOT EXISTS (
       SELECT 1 FROM messages WHERE whatsapp_message_id = $8::varchar AND direction = 'inbound'
     )
     RETURNING id, created_at`,
    [
      device.tenant_id,
      device.id,
      deviceKey,
      fromNumber,
      remoteJid.endsWith('@g.us') ? remoteJid : device.phone_number ?? deviceKey,
      remoteJid,
      parsed.content,
      parsed.type,
      message.key.id,
      Number.isFinite(timestampSeconds) ? timestampSeconds : 0,
    ],
  );
  const row = inserted.rows[0] as { id: string; created_at: Date } | undefined;
  if (!row) {
    log.debug('Duplicate incoming WhatsApp message ignored', {
      deviceKey,
      whatsappMessageId: message.key.id,
    });
    return;
  }

  // An inbound message from someone we recently wrote to is a reply; the
  // health score's reply rate depends on replied_at being recorded.
  await queryFn(
    `UPDATE messages SET replied_at = now()
     WHERE id = (
       SELECT id FROM messages
       WHERE device_id = $1::uuid AND direction = 'outbound' AND to_number = $2::varchar
         AND replied_at IS NULL AND status IN ('sent', 'delivered', 'read')
         AND COALESCE(sent_at, created_at) >= now() - interval '7 days'
       ORDER BY COALESCE(sent_at, created_at) DESC LIMIT 1
     )`,
    [device.id, fromNumber],
  );

  const inboundRecord: IncomingMessageRecord = {
    id: row.id, whatsappMessageId: message.key.id, tenantId: device.tenant_id, deviceId: device.id,
    deviceKey, from: fromNumber, content: parsed.content, type: parsed.type,
    replyJid: remoteJid, isGroup: remoteJid.endsWith('@g.us'), key: message.key,
  };
  const consentCommand = await recordRecipientConsentCommand(inboundRecord, log);
  if (consentCommand) inboundRecord.consentCommand = consentCommand;
  if (consentCommand === 'stop' && beforeWebhook) {
    try {
      await beforeWebhook(inboundRecord);
    } catch (error) {
      log.error('STOP confirmation handler failed before webhook dispatch', {
        tenantId: device.tenant_id, recipientLast4: fromNumber.slice(-4),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const payload: WebhookPayload = {
    event: 'message.received',
    device_key: deviceKey,
    message_id: row.id,
    whatsapp_message_id: message.key.id,
    from: fromNumber,
    chat_jid: remoteJid,
    is_group: remoteJid.endsWith('@g.us'),
    content: parsed.content,
    direction: 'inbound',
    status: 'received',
    timestamp: row.created_at.toISOString(),
  };
  await webhookDispatcher(device.tenant_id, payload, { queryFn });
  log.info('Incoming WhatsApp message saved', {
    messageId: row.id,
    whatsappMessageId: message.key.id,
    deviceKey,
    from: fromNumber,
    type: parsed.type,
  });
  return inboundRecord;
}

export interface IncomingMessageRecord {
  id: string; whatsappMessageId: string; tenantId: string; deviceId: string; deviceKey: string; from: string; content: string;
  type: 'text' | 'image' | 'document' | 'video' | 'audio';
  consentCommand?: 'stop' | 'start';
  /** Chat JID to answer on (may be @lid); never rebuild it from `from`. */
  replyJid: string;
  isGroup: boolean;
  key: WAMessageKey;
}

/** Persist START/STOP before webhook handling or any auto-reply decision. */
async function recordRecipientConsentCommand(
  message: IncomingMessageRecord,
  log: Logger,
): Promise<'stop' | 'start' | undefined> {
  if (message.isGroup || message.type !== 'text') return undefined;
  const command = parseConsentKeyword(message.content);
  if (!command) return undefined;
  const phoneNumber = normalizeRecipientNumber(message.from);

  const persistedCommand = await withRecipientConsentLock(message.tenantId, phoneNumber, async () =>
    transaction(async (client) => {
      const event = await client.query<{ id: string }>(
        `INSERT INTO recipient_consent_events
           (tenant_id, phone_number, status, source, evidence_ref, actor_kind)
         VALUES ($1, $2, $3, 'inbound_keyword', $4, 'system')
         ON CONFLICT DO NOTHING RETURNING id`,
        [message.tenantId, phoneNumber, command === 'stop' ? 'opted_out' : 'opted_in', message.whatsappMessageId],
      );
      if (!event.rows[0]) return { recorded: false, suppressed: 0 };
      await client.query(
        `INSERT INTO recipient_preferences
           (tenant_id, phone_number, status, source, evidence_ref, decided_at, updated_at)
         VALUES ($1, $2, $3, 'inbound_keyword', $4, now(), now())
         ON CONFLICT (tenant_id, phone_number) DO UPDATE SET
           status = EXCLUDED.status, source = EXCLUDED.source, source_note = NULL,
           evidence_ref = EXCLUDED.evidence_ref, decided_by = NULL,
           decided_at = now(), updated_at = now()`,
        [message.tenantId, phoneNumber, command === 'stop' ? 'opted_out' : 'opted_in', message.whatsappMessageId],
      );
      let suppressed = 0;
      if (command === 'stop') {
        const result = await client.query(
          `UPDATE messages SET status = 'blocked', error_message = 'recipient_opted_out'
           WHERE tenant_id = $1 AND regexp_replace(to_number, '[^0-9]', '', 'g') = $2
             AND direction = 'outbound' AND status IN ('queued', 'quota_hold')
             AND COALESCE(quota_exempt, false) = false`,
          [message.tenantId, phoneNumber],
        );
        suppressed = result.rowCount ?? 0;
      }
      return { recorded: true, suppressed };
    }));
  if (persistedCommand.recorded) log.info(`Recipient ${command.toUpperCase()} recorded`, {
    tenantId: message.tenantId, recipientLast4: phoneNumber.slice(-4),
    inboundMessageId: message.id, suppressedMessages: persistedCommand.suppressed,
  });
  return command;
}

/** At most one STOP acknowledgement attempt per persisted inbound message; it is non-promotional and logged. */
export async function sendStopConfirmation(
  message: IncomingMessageRecord,
  sock: WASocket,
  log: Logger,
): Promise<void> {
  const phoneNumber = normalizeRecipientNumber(message.from);
  await withRecipientConsentLock(message.tenantId, phoneNumber, async () => {
    const existing = await pool.query<{ id: string }>(
      'SELECT id FROM messages WHERE tenant_id = $1 AND external_id = $2 LIMIT 1',
    [message.tenantId, `consent-stop:${message.whatsappMessageId}`],
    );
    if (existing.rows[0]) return;
    const acknowledgement = await pool.query<{ id: string }>(
      `INSERT INTO messages
         (tenant_id, device_id, device_key, from_number, to_number, content, type, status, direction, external_id)
       VALUES ($1, $2, $3, $3, $4, $5, 'text', 'sending', 'outbound', $6) RETURNING id`,
      [message.tenantId, message.deviceId, message.deviceKey, phoneNumber,
        'Anda sudah berhenti menerima pesan promosi KONEVA.', `consent-stop:${message.whatsappMessageId}`],
    );
    const outboundId = acknowledgement.rows[0]?.id;
    try {
      const result = await sock.sendMessage(message.replyJid ?? `${phoneNumber}@s.whatsapp.net`, {
        text: 'Anda sudah berhenti menerima pesan promosi KONEVA.',
      });
      if (outboundId) await pool.query(
        `UPDATE messages SET status = 'sent', whatsapp_message_id = $2, sent_at = now() WHERE id = $1`,
        [outboundId, result?.key.id ?? null]);
      log.info('Recipient STOP confirmation sent', { tenantId: message.tenantId, recipientLast4: phoneNumber.slice(-4), inboundMessageId: message.id });
    } catch (error) {
      if (outboundId) await pool.query(
        `UPDATE messages SET status = 'failed', error_message = 'consent_ack_failed' WHERE id = $1`, [outboundId]);
      log.error('Recipient STOP confirmation failed', {
        tenantId: message.tenantId, recipientLast4: phoneNumber.slice(-4), inboundMessageId: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

export function registerIncomingMessageListener(
  sock: WASocket,
  deviceKey: string,
  log: Logger,
  queryFn: QueryFn = defaultQueryFn,
  onIncoming?: (message: IncomingMessageRecord) => Promise<void>,
): void {
  sock.ev.on('messages.upsert', (upsert: BaileysEventMap['messages.upsert']) => {
    log.info('WhatsApp messages.upsert received', {
      deviceKey,
      upsertType: upsert.type,
      messageCount: upsert.messages.length,
    });
    log.debug('WhatsApp messages.upsert payload', { deviceKey, messages: upsert.messages });
    if (upsert.type !== 'notify') return;

    for (const message of upsert.messages) {
      let stopHandled = false;
      void handleIncomingMessage(message, deviceKey, queryFn, log, dispatchWebhook, async (saved) => {
        if (!onIncoming) return;
        stopHandled = true;
        await onIncoming(saved);
      }).then(async (saved) => {
        if (saved && onIncoming && !(stopHandled && saved.consentCommand === 'stop')) await onIncoming(saved);
      }).catch((error: unknown) => {
        log.error('Failed to save incoming WhatsApp message', {
          deviceKey,
          whatsappMessageId: message.key.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  });
}
