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
       tenant_id, device_id, device_key, from_number, to_number, content, type,
       status, direction, whatsapp_message_id, created_at
     )
     SELECT $1::uuid, $2::uuid, $3::varchar, $4::varchar, $5::varchar, $6::text, $7::varchar,
            'received', 'inbound', $8::varchar,
            CASE WHEN $9::double precision > 0 THEN to_timestamp($9::double precision) ELSE now() END
     WHERE NOT EXISTS (
       SELECT 1 FROM messages WHERE whatsapp_message_id = $8::varchar AND direction = 'inbound'
     )
     RETURNING id, created_at`,
    [
      device.tenant_id,
      device.id,
      deviceKey,
      fromNumber,
      device.phone_number ?? deviceKey,
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

  const payload: WebhookPayload = {
    event: 'message.received',
    device_key: deviceKey,
    message_id: row.id,
    whatsapp_message_id: message.key.id,
    from: fromNumber,
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
  return {
    id: row.id, tenantId: device.tenant_id, deviceId: device.id,
    deviceKey, from: fromNumber, content: parsed.content,
    replyJid: remoteJid, isGroup: remoteJid.endsWith('@g.us'), key: message.key,
  };
}

export interface IncomingMessageRecord {
  id: string; tenantId: string; deviceId: string; deviceKey: string; from: string; content: string;
  /** Chat JID to answer on (may be @lid); never rebuild it from `from`. */
  replyJid: string;
  isGroup: boolean;
  key: WAMessageKey;
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
      void handleIncomingMessage(message, deviceKey, queryFn, log).then(async (saved) => {
        if (saved && onIncoming) await onIncoming(saved);
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
