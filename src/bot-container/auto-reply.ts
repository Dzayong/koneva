import type { PresenceRoutine } from './presence';
import type { WASocket, WAMessageKey } from '@whiskeysockets/baileys';
import type { Logger } from 'winston';
import type Redis from 'ioredis';
import { renderMessageTemplate } from '../shared/utils/message-template';
import { canSendMessage, type AntiBanDecision } from './anti-ban';
import type { QueryFn } from './health-score';

export interface AutoReplyRule {
  id: string;
  tenant_id: string;
  device_key: string;
  trigger: { type: 'keyword' | 'regex' | 'all'; pattern: string };
  response: { type: 'text' | 'template'; content: string; delay_ms: number };
  is_active: boolean;
}

interface RuleRow {
  id: string; tenant_id: string; device_key: string; trigger_type: AutoReplyRule['trigger']['type'];
  trigger_pattern: string; response_type: AutoReplyRule['response']['type']; response_content: string;
  delay_ms: number; is_active: boolean;
}

export interface IncomingForAutoReply {
  id: string; tenantId: string; deviceId: string; deviceKey: string; from: string; content: string;
  replyJid?: string; isGroup?: boolean; key?: WAMessageKey;
}

export async function loadAutoReplyRules(deviceKey: string, queryFn: QueryFn): Promise<AutoReplyRule[]> {
  const result = await queryFn(
    `SELECT id, tenant_id, device_key, trigger_type, trigger_pattern, response_type,
            response_content, delay_ms, is_active
     FROM auto_reply_rules WHERE device_key=$1 AND is_active=true ORDER BY created_at`,
    [deviceKey],
  );
  return (result.rows as unknown as RuleRow[]).map((row) => ({
    id: row.id, tenant_id: row.tenant_id, device_key: row.device_key,
    trigger: { type: row.trigger_type, pattern: row.trigger_pattern },
    response: { type: row.response_type, content: row.response_content, delay_ms: row.delay_ms },
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
    const truncated = content.slice(0, 2000);
    return new RegExp(rule.trigger.pattern, 'i').test(truncated);
  }
  catch { return false; }
}

interface AutoReplyDependencies {
  canSend?: (deviceKey: string) => Promise<AntiBanDecision>;
  wait?: (milliseconds: number) => Promise<void>;
  /** When set, going online and reading are owned by the presence routine. */
  presence?: Pick<PresenceRoutine, 'beforeReply' | 'afterSend'>;
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
  // A bot answering inside groups reads as spam; auto-reply is for direct chats only.
  if (message.isGroup) return false;

  const rule = rules.find((candidate) => candidate.tenant_id === message.tenantId && matchesAutoReply(candidate, message.content));
  if (!rule) return false;

  const contactResult = await queryFn(
    'SELECT name FROM contacts WHERE tenant_id=$1 AND phone_number IN ($2, $3) LIMIT 1',
    [message.tenantId, message.from, `+${message.from}`],
  );
  const contactName = (contactResult.rows[0] as { name?: string } | undefined)?.name;
  const content = rule.response.type === 'template'
    ? renderMessageTemplate(rule.response.content, {
      nama: contactName ?? message.from, nomor: message.from,
      tanggal: new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeZone: 'Asia/Jakarta' }).format(new Date()),
    })
    : rule.response.content;

  const decision = dependencies.canSend
    ? await dependencies.canSend(message.deviceKey)
    : await canSendMessage(message.deviceKey, {
      queryFn, isProactive: false, content, recipient: message.from,
      recipientName: contactName, requirePersonalization: false,
    });
  if (!decision.allowed) {
    await logActivity(queryFn, rule, message, content, 'blocked', decision.reason ?? 'blocked', null);
    log.warn('Auto-reply blocked by anti-ban policy', { ruleId: rule.id, reason: decision.reason });
    return false;
  }

  const wait = dependencies.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  // Answer on the chat the message arrived on; rebuilding a JID from the
  // number breaks for @lid chats.
  const jid = message.replyJid ?? `${message.from}@s.whatsapp.net`;
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
    const sent = await sock.sendMessage(jid, { text: content });
    void dependencies.presence?.afterSend();
    const inserted = await queryFn(
      `INSERT INTO messages (tenant_id, device_id, device_key, from_number, to_number, content,
       type, status, direction, whatsapp_message_id, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,'text','sent','outbound',$7,NOW()) RETURNING id`,
      [message.tenantId, message.deviceId, message.deviceKey, message.deviceKey, message.from, content, sent?.key.id ?? null],
    );
    const outboundId = (inserted.rows[0] as { id?: string } | undefined)?.id ?? null;
    await logActivity(queryFn, rule, message, content, 'sent', null, outboundId);
    log.info('Auto-reply sent', { ruleId: rule.id, inboundMessageId: message.id, outboundMessageId: outboundId });
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await logActivity(queryFn, rule, message, content, 'failed', reason, null);
    log.error('Auto-reply failed', { ruleId: rule.id, error: reason });
    return false;
  }
}
