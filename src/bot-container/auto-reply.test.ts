import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WASocket } from '@whiskeysockets/baileys';
import type { Logger } from 'winston';
import { AutoReplyEngine, matchesAutoReply, processAutoReply, type AutoReplyRule } from './auto-reply';
import type { QueryFn } from './health-score';

const baseRule: AutoReplyRule = {
  id: 'rule-1', tenant_id: 'tenant-1', device_key: 'WAPI-1', is_active: true,
  trigger: { type: 'keyword', pattern: 'harga' },
  response: { type: 'template', content: '{Halo|Hi} {nama}', delay_ms: 3000 },
};

test('auto-reply matching supports keyword, regex, and all rules', () => {
  assert.equal(matchesAutoReply(baseRule, 'Berapa HARGA produk?'), true);
  assert.equal(matchesAutoReply({ ...baseRule, trigger: { type: 'regex', pattern: '^order \\d+$' } }, 'ORDER 42'), true);
  assert.equal(matchesAutoReply({ ...baseRule, trigger: { type: 'all', pattern: '' } }, 'anything'), true);
  assert.equal(matchesAutoReply({ ...baseRule, is_active: false }, 'harga'), false);
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
    { id: 'in-1', tenantId: 'tenant-1', deviceId: 'device-1', deviceKey: 'WAPI-1', from: '62812', content: 'harga?' },
    [baseRule], sock, queryFn, silent,
    { wait: async () => undefined, guard: async () => ({ allowed: true }), canSend: async () => ({ allowed: true, delayMs: 0,
      typing: { shouldSimulate: false, durationMs: 0 }, healthScore: 80, dailyCap: 20, sentToday: 1, warmupDay: 5 }),
      consentLock: async (_tenant, _recipient, work) => work() },
  );

  assert.equal(sent, true);
  assert.match(sentText, /^(Halo|Hi) Budi$/);
  assert.equal(queries.some((sql) => sql.includes('INSERT INTO auto_reply_logs')), true);
  assert.equal(queries.some((sql) => sql.includes('INSERT INTO messages')), true);
});

test('auto-reply refuses a non-opted-in recipient and writes a blocked activity row', async () => {
  const queries: string[] = [];
  const queryFn: QueryFn = async (sql) => { queries.push(sql); return { rows: [] } as never; };
  let sends = 0;
  const sock = { sendMessage: async () => { sends += 1; return { key: { id: 'unexpected' } }; } } as unknown as WASocket;
  const silent = { info() {}, warn() {}, error() {} } as unknown as Logger;
  const sent = await processAutoReply(
    { id: 'in-no-consent', tenantId: 'tenant-1', deviceId: 'device-1', deviceKey: 'WAPI-1', from: '62812', content: 'harga?' },
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
    { id: 'in-2', tenantId: 'tenant-1', deviceId: 'device-1', deviceKey: 'WAPI-1', from: '62812', content: 'harga?',
      key: { remoteJid: '62812@s.whatsapp.net', id: 'K1', fromMe: false } },
    [rule], sock, queryFn, silent,
    { wait: async (ms) => { waits.push(ms); }, guard: async () => ({ allowed: true }),
      consentLock: async (_tenant, _recipient, work) => work(),
      canSend: async () => ({ allowed: true, delayMs: 5000, typing: { shouldSimulate: true, durationMs: 3200 },
        healthScore: 80, dailyCap: 20, sentToday: 1, warmupDay: 5 }) },
  );

  assert.equal(waits.reduce((a, b) => a + b, 0), 5000);
  assert.ok(waits.every((ms) => ms >= 0));
});
