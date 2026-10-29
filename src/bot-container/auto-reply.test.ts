import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WASocket } from '@whiskeysockets/baileys';
import type { Logger } from 'winston';
import { AutoReplyEngine, matchesAutoReply, processAutoReply, type AutoReplyRule } from './auto-reply';
import type { QueryFn } from './health-score';
import { isSafeAutoReplyRegex } from '../shared/safe-auto-reply-regex';

const baseRule: AutoReplyRule = {
  id: 'rule-1', tenant_id: 'tenant-1', device_key: 'WAPI-1', is_active: true,
  trigger: { type: 'keyword', pattern: 'harga' },
  response: { type: 'template', content: '{Halo|Hi} {nama}', delay_ms: 3000 },
  destination_scope: 'group',
};

test('auto-reply matching supports keyword, regex, and all rules', () => {
  assert.equal(matchesAutoReply(baseRule, 'Berapa HARGA produk?'), true);
  assert.equal(matchesAutoReply({ ...baseRule, trigger: { type: 'regex', pattern: '^order \\d+$' } }, 'ORDER 42'), true);
  assert.equal(matchesAutoReply({ ...baseRule, trigger: { type: 'all', pattern: '' } }, 'anything'), true);
  assert.equal(matchesAutoReply({ ...baseRule, is_active: false }, 'harga'), false);
});

test('auto-reply regex rejects catastrophic groups/alternation and accepts bounded simple patterns', () => {
  assert.equal(isSafeAutoReplyRegex('^(a|a?)+$'), false);
  assert.equal(isSafeAutoReplyRegex('(a+)+$'), false);
  assert.equal(isSafeAutoReplyRegex('^order \\d+$'), true);
  assert.equal(isSafeAutoReplyRegex('['), false);
});

test('matched inbound message sends and records an auto-reply', async () => {
  const queries: string[] = [];
  const queryFn: QueryFn = async (sql) => {
    queries.push(sql);
    if (sql.includes('FROM recipient_preferences')) return { rows: [{ status: 'opted_in' }] } as never;
    if (sql.startsWith('SELECT name')) return { rows: [{ name: 'Budi' }] } as never;
    if (sql.includes('INSERT INTO messages')) return { rows: [{ id: 'out-1' }] } as never;
    return { rows: [] } as never;
  };
  let sentText = '';
  const sock = {
    sendMessage: async (_jid: string, content: { text: string }) => { sentText = content.text; return { key: { id: 'wa-1' } }; },
    sendPresenceUpdate: async () => undefined,
  } as unknown as WASocket;
  const silent = { info() {}, warn() {}, error() {} } as unknown as Logger;

  const sent = await processAutoReply(
    { id: 'in-1', tenantId: 'tenant-1', deviceId: 'device-1', deviceKey: 'WAPI-1', from: '62812', content: 'harga?', isGroup: true, replyJid: '120363000000@g.us' },
    [baseRule], sock, queryFn, silent,
    { wait: async () => undefined, guard: async () => ({ allowed: true }), canSend: async () => ({ allowed: true, delayMs: 0,
      typing: { shouldSimulate: false, durationMs: 0 }, healthScore: 80, dailyCap: 20, sentToday: 1 }),
      consentLock: async (_tenant, _recipient, work) => work() },
  );

  assert.equal(sent, true);
  assert.match(sentText, /^(Halo|Hi) Budi$/);
  assert.equal(queries.some((sql) => sql.includes('INSERT INTO auto_reply_logs')), true);
  assert.equal(queries.some((sql) => sql.includes('INSERT INTO messages')), true);
});

test('auto-reply answers an inbound chat without a prior START opt-in', async () => {
  const queries: string[] = [];
  const queryFn: QueryFn = async (sql) => {
    queries.push(sql);
    if (sql.includes('INSERT INTO messages')) return { rows: [{ id: 'reply-1' }] } as never;
    return { rows: [] } as never;
  };
  let sends = 0;
  const sock = { sendMessage: async () => { sends += 1; return { key: { id: 'reply-wa-1' } }; } } as unknown as WASocket;
  const silent = { info() {}, warn() {}, error() {} } as unknown as Logger;
  const sent = await processAutoReply(
    { id: 'in-no-consent', tenantId: 'tenant-1', deviceId: 'device-1', deviceKey: 'WAPI-1', from: '62812', content: 'harga?', isGroup: true, replyJid: '120363000000@g.us' },
    [baseRule], sock, queryFn, silent,
    { wait: async () => undefined, guard: async () => ({ allowed: true }), canSend: async () => ({ allowed: true, delayMs: 0,
      typing: { shouldSimulate: false, durationMs: 0 }, healthScore: 80, dailyCap: 20, sentToday: 1 }),
      consentLock: async (_tenant, _recipient, work) => work() },
  );
  assert.equal(sent, true);
  assert.equal(sends, 1);
  assert.equal(queries.some((sql) => sql.includes('INSERT INTO auto_reply_logs')), true);
});

test('auto-reply still respects an explicit STOP', async () => {
  const queries: string[] = [];
  const queryFn: QueryFn = async (sql) => { queries.push(sql); return { rows: [{ status: 'opted_out' }] } as never; };
  let sends = 0;
  const sock = { sendMessage: async () => { sends += 1; return { key: { id: 'unexpected' } }; } } as unknown as WASocket;
  const silent = { info() {}, warn() {}, error() {} } as unknown as Logger;
  const sent = await processAutoReply(
    { id: 'in-opted-out', tenantId: 'tenant-1', deviceId: 'device-1', deviceKey: 'WAPI-1', from: '62812', content: 'harga?', isGroup: true, replyJid: '120363000000@g.us' },
    [baseRule], sock, queryFn, silent,
    { consentLock: async (_tenant, _recipient, work) => work() },
  );
  assert.equal(sent, false);
  assert.equal(sends, 0);
  assert.equal(queries.some((sql) => sql.includes('INSERT INTO auto_reply_logs')), true);
});

test('auto-reply engine hot-reloads rules after its Redis signal', async () => {
  let databaseRules = [baseRule];
  let messageListener: ((channel: string, message: string) => void) | undefined;
  const subscriber = {
    on(event: string, listener: (channel: string, message: string) => void) {
      if (event === 'message') messageListener = listener;
      return this;
    },
    async subscribe(channel: string) { assert.equal(channel, 'bot:reload-rules:WAPI-1'); return 1; },
    async unsubscribe() { return 0; },
    async quit() { return 'OK'; },
  };
  const redis = { duplicate: () => subscriber };
  const queryFn: QueryFn = async () => ({ rows: databaseRules.map((rule) => ({
    id: rule.id, tenant_id: rule.tenant_id, device_key: rule.device_key,
    trigger_type: rule.trigger.type, trigger_pattern: rule.trigger.pattern,
    response_type: rule.response.type, response_content: rule.response.content,
    delay_ms: rule.response.delay_ms, is_active: rule.is_active,
  })) }) as never;
  const silent = { info() {}, warn() {}, error() {} } as unknown as Logger;
  const engine = new AutoReplyEngine('WAPI-1', queryFn, redis as never, silent);
  await engine.initialize();
  assert.equal(engine.getRules()[0]?.trigger.pattern, 'harga');

  databaseRules = [{ ...baseRule, trigger: { type: 'keyword', pattern: 'bantuan' } }];
  messageListener?.('bot:reload-rules:WAPI-1', '{}');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(engine.getRules()[0]?.trigger.pattern, 'bantuan');
  await engine.close();
});

test('auto-reply total delay includes reading and typing, so a flat 5 s is 5 s', async () => {
  const waits: number[] = [];
  const queryFn: QueryFn = async (sql) => sql.includes('FROM recipient_preferences')
    ? ({ rows: [{ status: 'opted_in' }] } as never)
    : ({ rows: [] } as never);
  const sock = {
    sendMessage: async () => ({ key: { id: 'wa-2' } }),
    sendPresenceUpdate: async () => undefined,
    readMessages: async () => undefined,
  } as unknown as WASocket;
  const silent = { info() {}, warn() {}, error() {}, debug() {} } as unknown as Logger;
  const rule = { ...baseRule, response: { type: 'text' as const, content: 'Halo', delay_ms: 0 } };

  await processAutoReply(
    { id: 'in-2', tenantId: 'tenant-1', deviceId: 'device-1', deviceKey: 'WAPI-1', from: '62812', content: 'harga?', isGroup: true,
      replyJid: '120363000000@g.us', key: { remoteJid: '120363000000@g.us', participant: '62812@s.whatsapp.net', id: 'K1', fromMe: false } },
    [rule], sock, queryFn, silent,
    { wait: async (ms) => { waits.push(ms); }, guard: async () => ({ allowed: true }),
      consentLock: async (_tenant, _recipient, work) => work(),
      canSend: async () => ({ allowed: true, delayMs: 5000, typing: { shouldSimulate: true, durationMs: 3200 },
        healthScore: 80, dailyCap: 20, sentToday: 1 }) },
  );

  assert.equal(waits.reduce((a, b) => a + b, 0), 5000);
  assert.ok(waits.every((ms) => ms >= 0));
});

test('auto-reply never processes private chats or channel traffic', async () => {
  let sends = 0;
  const queryFn: QueryFn = async () => ({ rows: [] }) as never;
  const sock = { sendMessage: async () => { sends += 1; return { key: { id: 'unexpected' } }; } } as unknown as WASocket;
  const silent = { info() {}, warn() {}, error() {} } as unknown as Logger;
  for (const isGroup of [false, undefined]) {
    const message = { id: `in-private-${String(isGroup)}`, tenantId: 'tenant-1', deviceId: 'device-1', deviceKey: 'WAPI-1', from: '62812', content: 'harga?',
      ...(isGroup !== undefined ? { isGroup } : {}) };
    const sent = await processAutoReply(
      message,
      [baseRule], sock, queryFn, silent,
    );
    assert.equal(sent, false);
  }
  assert.equal(sends, 0);
});

test('destination_scope controls which chat types trigger auto-reply', async () => {
  const queryFn: QueryFn = async () => ({ rows: [] }) as never;
  const sock = { sendMessage: async () => ({ key: { id: 'wa-scope' } }) } as unknown as WASocket;
  const silent = { info() {}, warn() {}, error() {}, debug() {} } as unknown as Logger;

  const privateRule: AutoReplyRule = { ...baseRule, destination_scope: 'private' };
  const allRule: AutoReplyRule = { ...baseRule, destination_scope: 'all' };
  const groupRule: AutoReplyRule = { ...baseRule, destination_scope: 'group' };

  const groupMsg = { id: 'g1', tenantId: 'tenant-1', deviceId: 'device-1', deviceKey: 'WAPI-1', from: '62812', content: 'harga?', isGroup: true, replyJid: '120363@g.us' };
  const privateMsg = { id: 'p1', tenantId: 'tenant-1', deviceId: 'device-1', deviceKey: 'WAPI-1', from: '62812', content: 'harga?', isGroup: false };

  // group rule matches group, not private
  assert.equal(await processAutoReply(groupMsg, [groupRule], sock, queryFn, silent), false); // no consent row → no_matching_rule path or consent path
  assert.equal(await processAutoReply(privateMsg, [groupRule], sock, queryFn, silent), false);

  // private rule matches private, not group
  assert.equal(await processAutoReply(groupMsg, [privateRule], sock, queryFn, silent), false);
  assert.equal(await processAutoReply(privateMsg, [privateRule], sock, queryFn, silent), false); // no consent → still reaches rule match

  // all rule matches both
  assert.equal(await processAutoReply(groupMsg, [allRule], sock, queryFn, silent), false); // no consent
  assert.equal(await processAutoReply(privateMsg, [allRule], sock, queryFn, silent), false); // no consent but rule IS matched
});
