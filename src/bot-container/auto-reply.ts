import type { PresenceRoutine } from './presence';
import type { WASocket, WAMessage, WAMessageKey } from '@whiskeysockets/baileys';
import type { Logger } from 'winston';
import type Redis from 'ioredis';
import { renderMessageTemplate } from '../shared/utils/message-template';
import { checkTransmission, type TransmitDecision } from './send-guard';
import { canSendMessage, type AntiBanDecision } from './anti-ban';
import type { QueryFn } from './health-score';
import { getStoredRecipientConsent, withRecipientConsentLock } from '../shared/recipient-consent';
import { isSafeAutoReplyRegex } from '../shared/safe-auto-reply-regex';
import { withDeviceSendLock } from '../shared/device-send-lock';
import { transaction } from '../shared/database/connection';
import { reserveMessageCharge } from '../api-gateway/services/wallet.service';

export interface AutoReplyRule {
  id: string;
  tenant_id: string;
  device_key: string;
  trigger: { type: 'keyword' | 'regex' | 'all'; pattern: string };
  response: { type: 'text' | 'template' | 'ai' | 'ai_general'; content: string; delay_ms: number };
  response_config?: { reply_to_trigger?: boolean };
  is_active: boolean;
}

interface RuleRow {
  id: string; tenant_id: string; device_key: string; trigger_type: AutoReplyRule['trigger']['type'];
  trigger_pattern: string; response_type: AutoReplyRule['response']['type']; response_content: string;
  delay_ms: number; is_active: boolean; response_config?: unknown;
}

export interface IncomingForAutoReply {
  id: string; tenantId: string; deviceId: string; deviceKey: string; from: string; content: string;
  type?: 'text' | 'image' | 'document' | 'video' | 'audio'; consentCommand?: 'stop' | 'start';
  replyJid?: string; isGroup?: boolean; key?: WAMessageKey;
  mediaId?: string; quotedMessage?: WAMessage;
}

export async function loadAutoReplyRules(deviceKey: string, queryFn: QueryFn): Promise<AutoReplyRule[]> {
  const result = await queryFn(
    `SELECT id, tenant_id, device_key, trigger_type, trigger_pattern, response_type,
            response_content, response_config, delay_ms, is_active
     FROM auto_reply_rules WHERE device_key=$1 AND is_active=true ORDER BY created_at`,
    [deviceKey],
  );
  return (result.rows as unknown as RuleRow[]).map((row) => ({
    id: row.id, tenant_id: row.tenant_id, device_key: row.device_key,
    trigger: { type: row.trigger_type, pattern: row.trigger_pattern },
    response: { type: row.response_type, content: row.response_content, delay_ms: row.delay_ms },
    response_config: typeof row.response_config === 'object' && row.response_config !== null && !Array.isArray(row.response_config)
      ? row.response_config as { reply_to_trigger?: boolean }
      : { reply_to_trigger: true },
    is_active: row.is_active,
  }));
}

type RedisSubscriber = Pick<Redis, 'subscribe' | 'unsubscribe' | 'on' | 'quit'>;
type RedisConnection = Pick<Redis, 'duplicate'>;

export class AutoReplyEngine {
  private rules: AutoReplyRule[] = [];
  private subscriber: RedisSubscriber | undefined;
  private readonly channel: string;

  constructor(
    private readonly deviceKey: string,
    private readonly queryFn: QueryFn,
    private readonly redis: RedisConnection,
    private readonly log: Logger,
  ) {
    this.channel = `bot:reload-rules:${deviceKey}`;
  }

  async initialize(): Promise<void> {
    await this.reload();
    const subscriber = this.redis.duplicate() as RedisSubscriber;
    this.subscriber = subscriber;
    subscriber.on('message', (channel: string) => {
      if (channel !== this.channel) return;
      void this.reload().catch((error: unknown) => {
        this.log.error('Failed to hot-reload auto-reply rules', {
          deviceKey: this.deviceKey,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });
    await subscriber.subscribe(this.channel);
    this.log.info('Auto-reply reload listener ready', { channel: this.channel });
  }

  async reload(): Promise<void> {
    const loaded = await loadAutoReplyRules(this.deviceKey, this.queryFn);
    this.rules = loaded;
    this.log.info('Auto-reply rules loaded', { deviceKey: this.deviceKey, count: loaded.length });
  }

  async process(message: IncomingForAutoReply, sock: WASocket, presence?: AutoReplyDependencies['presence']): Promise<boolean> {
    return processAutoReply(message, this.rules, sock, this.queryFn, this.log, presence ? { presence } : {});
  }

  getRules(): readonly AutoReplyRule[] {
    return this.rules;
  }

  async close(): Promise<void> {
    if (!this.subscriber) return;
    await this.subscriber.unsubscribe(this.channel);
    await this.subscriber.quit();
    this.subscriber = undefined;
  }
}

export function matchesAutoReply(rule: AutoReplyRule, content: string): boolean {
  if (!rule.is_active) return false;
  if (rule.trigger.type === 'all') return true;
  if (rule.trigger.type === 'keyword') {
    return content.toLocaleLowerCase().includes(rule.trigger.pattern.toLocaleLowerCase());
  }
  try {
    if (!isSafeAutoReplyRegex(rule.trigger.pattern)) return false;
    const truncated = content.slice(0, 512);
    return new RegExp(rule.trigger.pattern, 'i').test(truncated);
  }
  catch { return false; }
}

interface AutoReplyDependencies {
  canSend?: (deviceKey: string) => Promise<AntiBanDecision>;
  /** Test hook for the administrative guard (workspace suspension, pause, ban). Default: the real check against the database. */
  guard?: (deviceKey: string) => Promise<TransmitDecision>;
  wait?: (milliseconds: number) => Promise<void>;
  /** When set, going online and reading are owned by the presence routine. */
  presence?: Pick<PresenceRoutine, 'beforeReply' | 'afterSend'>;
  consentLock?: <T>(tenantId: string, recipient: string, work: () => Promise<T>) => Promise<T>;
  deviceSendLock?: <T>(deviceKey: string, work: () => Promise<T>) => Promise<T>;
}

async function logActivity(
  queryFn: QueryFn, rule: AutoReplyRule, message: IncomingForAutoReply, content: string,
  status: 'sent' | 'blocked' | 'failed', error: string | null, outboundId: string | null,
): Promise<void> {
  await queryFn(
    `INSERT INTO auto_reply_logs (rule_id, tenant_id, device_key, inbound_message_id,
       outbound_message_id, recipient, response_content, status, error_message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [rule.id, message.tenantId, message.deviceKey, message.id, outboundId,
      message.from, content, status, error],
  );
}

export async function processAutoReply(
  message: IncomingForAutoReply,
  rules: AutoReplyRule[],
  sock: WASocket,
  queryFn: QueryFn,
  log: Logger,
  dependencies: AutoReplyDependencies = {},
): Promise<boolean> {
  // Auto-replies are deliberately limited to groups the connected number is
  // already part of. Direct chats and channel/newsletter traffic are excluded.
  if (!message.isGroup) return false;

  const rule = rules.find((candidate) => candidate.tenant_id === message.tenantId && matchesAutoReply(candidate, message.content));
  if (!rule) return false;

  const storedConsent = await getStoredRecipientConsent(queryFn, message.tenantId, message.from);
  // This rule answers the inbound message that just started the chat. It is not a proactive send;
  // still honor an explicit STOP and let the dedicated STOP confirmation run separately.
  if (storedConsent === 'opted_out' || message.consentCommand === 'stop') {
    const reason = 'recipient_opted_out';
    await logActivity(queryFn, rule, message, rule.response.content, 'blocked', reason, null);
    log.warn('Auto-reply blocked by recipient consent', {
      tenantId: message.tenantId, recipientLast4: message.from.replace(/\D/g, '').slice(-4), reason,
    });
    return false;
  }

  const contactResult = await queryFn(
    'SELECT name FROM contacts WHERE tenant_id=$1 AND phone_number IN ($2, $3) LIMIT 1',
    [message.tenantId, message.from, `+${message.from}`],
  );
  const contactName = (contactResult.rows[0] as { name?: string } | undefined)?.name;
  let content: string;
  try {
    content = rule.response.type === 'ai' || rule.response.type === 'ai_general'
      ? await generateAiReply(rule.id, message.deviceKey, message.content, message.from, contactName,
        message.type === 'image' ? message.id : undefined)
      : rule.response.type === 'template'
        ? renderMessageTemplate(rule.response.content, {
          nama: contactName ?? message.from, nomor: message.from,
          tanggal: new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeZone: 'Asia/Jakarta' }).format(new Date()),
        })
        : rule.response.content;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (rule.response.type === 'ai' || rule.response.type === 'ai_general') {
      await logActivity(queryFn, rule, message, '[AI reply unavailable]', 'failed', reason, null);
      log.error('AI auto-reply generation failed', { ruleId: rule.id, error: reason });
      return false;
    }
    throw error;
  }

  const decision = dependencies.canSend
    ? await dependencies.canSend(message.deviceKey)
    : await canSendMessage(message.deviceKey, {
      queryFn, isProactive: false, scheduleContext: 'auto_reply', content, recipient: message.from,
      recipientName: contactName, requirePersonalization: false,
    });
  if (!decision.allowed) {
    await logActivity(queryFn, rule, message, content, 'blocked', decision.reason ?? 'blocked', null);
    log.warn('Auto-reply blocked by anti-ban policy', { ruleId: rule.id, reason: decision.reason });
    return false;
  }

  // Administrative state (suspended workspace, paused or banned number). Auto-replies are events, not queued jobs: a reply that is
  // blocked is simply not sent, and nothing answers the same message retroactively after a recovery.
  const guard = dependencies.guard ?? ((deviceKey: string) => checkTransmission(deviceKey, queryFn));
  const early = await guard(message.deviceKey);
  if (!early.allowed) {
    await logActivity(queryFn, rule, message, content, 'blocked', early.reason ?? 'blocked', null);
    log.warn('Auto-reply blocked by administrative state', { ruleId: rule.id, reason: early.reason });
    return false;
  }

  const wait = dependencies.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  // Answer on the chat the message arrived on; rebuilding a JID from the
  // number breaks for @lid chats.
  const jid = message.replyJid ?? `${message.from}@s.whatsapp.net`;
  let outboundId: string | null = null;
  try {
    // Human order: notice and read the message, think, type, then send. The
    // configured delay is the total, so read and typing time fit inside it.
    const total = Math.max(rule.response.delay_ms, decision.delayMs);
    const typingMs = decision.typing.shouldSimulate ? Math.min(decision.typing.durationMs, Math.floor(total * 0.6)) : 0;
    const readAfterMs = Math.min(1_500 + Math.floor(Math.random() * 3_500), Math.floor(total * 0.3));
    await wait(readAfterMs);
    if (message.key && !dependencies.presence) {
      await sock.readMessages([message.key]).catch((error: unknown) => {
        log.debug('Failed to mark message as read', { error: error instanceof Error ? error.message : String(error) });
      });
    }
    await wait(Math.max(0, total - readAfterMs - typingMs));
    // Human order: the phone is on and the message read before anything is typed.
    await dependencies.presence?.beforeReply(message.key);
    if (typingMs > 0) {
      await sock.sendPresenceUpdate('composing', jid);
      await wait(typingMs);
      await sock.sendPresenceUpdate('paused', jid);
    }
    // LAST CHECK before the transport call: the waits, reading and typing above can last many seconds.
    const lock = dependencies.consentLock ?? withRecipientConsentLock;
    const result = await lock(message.tenantId, message.from, async () => {
      const deviceLock = dependencies.deviceSendLock ?? withDeviceSendLock;
      return deviceLock(message.deviceKey, async () => {
        const consent = await getStoredRecipientConsent(queryFn, message.tenantId, message.from);
        if (consent === 'opted_out') return { blocked: 'recipient_opted_out' };
        const latestDecision = dependencies.canSend
          ? await dependencies.canSend(message.deviceKey)
          : await canSendMessage(message.deviceKey, {
            queryFn, isProactive: false, scheduleContext: 'auto_reply', content, recipient: message.from,
            recipientName: contactName, requirePersonalization: false,
          });
        if (!latestDecision.allowed) return { blocked: latestDecision.reason ?? 'anti_ban_policy' };
        const last = await guard(message.deviceKey);
        if (!last.allowed) return { blocked: last.reason ?? 'blocked' };
        const payg = await queryFn('SELECT enabled FROM payg_settings WHERE singleton=true');
        if (Boolean((payg.rows[0] as { enabled?: boolean } | undefined)?.enabled)) {
          // Auto-replies use the connected socket directly, so reserve their charge here before
          // handing the message to WhatsApp. Updating status to sent invokes the wallet settlement
          // trigger; an ambiguous socket failure remains held for manual reconciliation.
          const preparedOutboundId = await transaction(async (client) => {
            const settings = await client.query<{ enabled: boolean }>(
              'SELECT enabled FROM payg_settings WHERE singleton=true FOR SHARE',
            );
            const inserted = await client.query<{ id: string }>(
              `INSERT INTO messages (tenant_id, device_id, device_key, from_number, to_number, content,
               chat_jid, type, status, direction, send_context, send_started_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,'text','sending','outbound','api',NOW()) RETURNING id`,
              [message.tenantId, message.deviceId, message.deviceKey, message.deviceKey,
                message.isGroup ? jid : message.from, content, jid],
            );
            if (settings.rows[0]?.enabled) {
              await reserveMessageCharge(client, message.tenantId, inserted.rows[0]!.id, 0);
            }
            return inserted.rows[0]!.id;
          });
          outboundId = preparedOutboundId;

          let sent: Awaited<ReturnType<WASocket['sendMessage']>>;
          try {
            sent = await sock.sendMessage(jid, { text: content },
              rule.response_config?.reply_to_trigger !== false && message.quotedMessage
                ? { quoted: message.quotedMessage }
                : undefined);
          } catch (error) {
            await queryFn(
              `UPDATE messages SET status='failed', error_message='delivery_uncertain' WHERE id=$1 AND status='sending'`,
              [preparedOutboundId],
            );
            throw error;
          }
          await queryFn(
            `UPDATE messages SET status='sent', whatsapp_message_id=$2, sent_at=NOW() WHERE id=$1`,
            [preparedOutboundId, sent?.key.id ?? null],
          );
          return { sent, outboundId: preparedOutboundId };
        }

        const sent = await sock.sendMessage(jid, { text: content },
          rule.response_config?.reply_to_trigger !== false && message.quotedMessage
            ? { quoted: message.quotedMessage }
            : undefined);
        const inserted = await queryFn(
          `INSERT INTO messages (tenant_id, device_id, device_key, from_number, to_number, content,
           chat_jid, type, status, direction, whatsapp_message_id, sent_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'text','sent','outbound',$8,NOW()) RETURNING id`,
          [message.tenantId, message.deviceId, message.deviceKey, message.deviceKey,
            message.isGroup ? jid : message.from, content, jid, sent?.key.id ?? null],
        );
        const insertedOutboundId = (inserted.rows[0] as { id?: string } | undefined)?.id ?? null;
        outboundId = insertedOutboundId;
        return { sent, outboundId: insertedOutboundId };
      });
    });
    if ('blocked' in result) {
      const reason = result.blocked;
      await logActivity(queryFn, rule, message, content, 'blocked', reason, null);
      log.warn('Auto-reply stopped before sending by consent or administrative state', {
        ruleId: rule.id, tenantId: message.tenantId, recipientLast4: message.from.replace(/\D/g, '').slice(-4), reason,
      });
      return false;
    }
    const sent = result.sent;
    void dependencies.presence?.afterSend();
    await logActivity(queryFn, rule, message, content, 'sent', null, result.outboundId);
    log.info('Auto-reply sent', { ruleId: rule.id, inboundMessageId: message.id, outboundMessageId: result.outboundId });
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await logActivity(queryFn, rule, message, content, 'failed', reason, outboundId);
    log.error('Auto-reply failed', { ruleId: rule.id, error: reason });
    return false;
  }
}

/** Bots proxy only the matched rule id and message; provider key/prompt remain inside the API gateway. */
async function generateAiReply(ruleId: string, deviceKey: string, inboundText: string, recipient: string, contactName?: string, inboundMessageId?: string): Promise<string> {
  const baseUrl = process.env['API_GATEWAY_URL'] ?? 'http://api-gateway:8000';
  const adminKey = process.env['ADMIN_API_KEY'];
  if (!adminKey) throw new Error('ai_reply_gateway_unavailable');
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/internal/ai-reply`, {
    method: 'POST',
    headers: { 'x-admin-key': adminKey, 'content-type': 'application/json' },
    body: JSON.stringify({ rule_id: ruleId, device_key: deviceKey, message: inboundText.slice(0, 4000), recipient: recipient.slice(0, 128), contact_name: contactName?.slice(0, 160), ...(inboundMessageId ? { inbound_message_id: inboundMessageId } : {}) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`ai_reply_gateway_http_${response.status}`);
  const payload = await response.json() as { data?: { message?: unknown } };
  const content = payload.data?.message;
  if (typeof content !== 'string' || !content.trim()) throw new Error('ai_reply_empty_response');
  return content.trim().slice(0, 4096);
}
