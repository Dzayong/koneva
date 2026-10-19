import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WAMessage } from '@whiskeysockets/baileys';
import type { Logger } from 'winston';
import { handleIncomingMessage, isIgnoredChat, resolveSenderNumber } from './incoming';
import type { QueryFn } from './health-score';
import { parseConsentKeyword } from '../shared/recipient-consent';

const silent = { info() {}, warn() {}, error() {}, debug() {} } as unknown as Logger;

test('1:1 message whose participant was rewritten to "" still resolves the sender', () => {
  // Baileys cleanMessage() turns undefined participant into ''.
  assert.equal(
    resolveSenderNumber({ remoteJid: '6281234567890@s.whatsapp.net', participant: '', fromMe: false, id: 'A' }),
    '6281234567890',
  );
});

test('@lid chats resolve to the phone number from remoteJidAlt', () => {
  assert.equal(
    resolveSenderNumber({
      remoteJid: '195185510199507@lid', remoteJidAlt: '6281234567890@s.whatsapp.net',
      participant: '', fromMe: false, id: 'A',
    }),
    '6281234567890',
  );
});

test('@lid chat without a phone alias falls back to the lid digits', () => {
  assert.equal(
    resolveSenderNumber({ remoteJid: '195185510199507@lid', participant: '', fromMe: false, id: 'A' }),
    '195185510199507',
  );
});

test('group messages use the participant, not the group id', () => {
  assert.equal(
    resolveSenderNumber({
      remoteJid: '120363000000@g.us', participant: '6281234567890@s.whatsapp.net', fromMe: false, id: 'A',
    }),
    '6281234567890',
  );
});

test('status broadcasts and newsletters are ignored chats', () => {
  assert.equal(isIgnoredChat('status@broadcast'), true);
  assert.equal(isIgnoredChat('1203@newsletter'), true);
  assert.equal(isIgnoredChat('6281@s.whatsapp.net'), false);
});

test('consent commands ignore punctuation/case but must be standalone', () => {
  assert.equal(parseConsentKeyword('  STOP!!! '), 'stop');
  assert.equal(parseConsentKeyword('Berhenti...'), 'stop');
  assert.equal(parseConsentKeyword('(MULAI)'), 'start');
  assert.equal(parseConsentKeyword('Start!'), 'start');
  assert.equal(parseConsentKeyword('Please STOP'), undefined);
  assert.equal(parseConsentKeyword('STOP diskon'), undefined);
  assert.equal(parseConsentKeyword('S T O P'), undefined);
});

test('a direct message with participant "" is saved and returns a reply JID', async () => {
  const inserts: unknown[][] = [];
  const queryFn: QueryFn = async (sql, params) => {
    if (sql.startsWith('SELECT id, tenant_id')) {
      return { rows: [{ id: 'dev-1', tenant_id: 'ten-1', phone_number: '+6285624509601' }] } as never;
    }
    if (sql.includes('INSERT INTO messages')) {
      inserts.push(params ?? []);
      return { rows: [{ id: 'msg-1', created_at: new Date('2026-09-25T15:00:00Z') }] } as never;
    }
    return { rows: [] } as never;
  };
  const message = {
    key: { remoteJid: '195185510199507@lid', remoteJidAlt: '6281234567890@s.whatsapp.net', participant: '', fromMe: false, id: 'WA1' },
    message: { conversation: 'halo' },
    messageTimestamp: 1_790_000_000,
  } as unknown as WAMessage;

  const saved = await handleIncomingMessage(message, 'WAPI-1', queryFn, silent, async () => undefined);

  assert.ok(saved);
  assert.equal(saved.from, '6281234567890');
  assert.equal(saved.replyJid, '195185510199507@lid');
  assert.equal(saved.isGroup, false);
  assert.equal(inserts[0]?.[3], '6281234567890');
});

test('group messages persist their group JID as the chat and destination context', async () => {
  const inserts: unknown[][] = [];
  const queryFn: QueryFn = async (sql, params) => {
    if (sql.startsWith('SELECT id, tenant_id')) return { rows: [{ id: 'dev-1', tenant_id: 'ten-1', phone_number: '+6285624509601' }] } as never;
    if (sql.includes('INSERT INTO messages')) { inserts.push(params ?? []); return { rows: [{ id: 'msg-group', created_at: new Date() }] } as never; }
    return { rows: [] } as never;
  };
  const message = {
    key: { remoteJid: '120363000000-123456@g.us', participant: '6281234567890@s.whatsapp.net', fromMe: false, id: 'WA-GROUP-1' },
    message: { conversation: 'tolong dibantu' }, messageTimestamp: 1_790_000_000,
  } as unknown as WAMessage;
  const saved = await handleIncomingMessage(message, 'WAPI-1', queryFn, silent, async () => undefined);
  assert.equal(saved?.isGroup, true);
  assert.equal(saved?.replyJid, '120363000000-123456@g.us');
  assert.equal(inserts[0]?.[3], '6281234567890');
  assert.equal(inserts[0]?.[4], '120363000000-123456@g.us');
  assert.equal(inserts[0]?.[5], '120363000000-123456@g.us');
});

test('own messages are never stored', async () => {
  let queried = false;
  const queryFn: QueryFn = async () => { queried = true; return { rows: [] } as never; };
  const message = { key: { remoteJid: '6281@s.whatsapp.net', fromMe: true, id: 'X' } } as unknown as WAMessage;
  assert.equal(await handleIncomingMessage(message, 'WAPI-1', queryFn, silent, async () => undefined), undefined);
  assert.equal(queried, false);
});

test('an inbound message marks the latest outbound message to that number as replied', async () => {
  const updates: unknown[][] = [];
  const queryFn: QueryFn = async (sql, params) => {
    if (sql.startsWith('SELECT id, tenant_id')) {
      return { rows: [{ id: 'dev-1', tenant_id: 'ten-1', phone_number: '+6285624509601' }] } as never;
    }
    if (sql.includes('INSERT INTO messages')) {
      return { rows: [{ id: 'msg-1', created_at: new Date('2026-09-25T15:00:00Z') }] } as never;
    }
    if (sql.includes('SET replied_at')) updates.push(params ?? []);
    return { rows: [] } as never;
  };
  const message = {
    key: { remoteJid: '6281234567890@s.whatsapp.net', participant: '', fromMe: false, id: 'WA2' },
    message: { conversation: 'ok' }, messageTimestamp: 1_790_000_000,
  } as unknown as WAMessage;

  await handleIncomingMessage(message, 'WAPI-1', queryFn, silent, async () => undefined);

  assert.deepEqual(updates, [['dev-1', '6281234567890']]);
});
