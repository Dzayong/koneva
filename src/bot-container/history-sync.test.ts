import assert from 'node:assert/strict';
import test from 'node:test';
import type { BaileysEventMap, WAMessage } from '@whiskeysockets/baileys';
import type { Logger } from 'winston';
import type { QueryFn } from './health-score';
import { latestHistoryMessageAt, normalizeHistoryProgress, recordHistoryBatch, recordHistoryStatus } from './history-sync';

const log = { info() {}, warn() {} } as unknown as Logger;

test('history aggregation returns only the newest valid timestamp', () => {
  const messages = [
    { messageTimestamp: 1_700_000_000 },
    { messageTimestamp: 1_710_000_000 },
    { messageTimestamp: 0 },
  ] as unknown as WAMessage[];
  assert.equal(latestHistoryMessageAt(messages)?.toISOString(), '2024-03-09T16:00:00.000Z');
  assert.equal(latestHistoryMessageAt([{ messageTimestamp: 0 } as unknown as WAMessage]), null);
});

test('history progress is clamped and rounded without inventing missing progress', () => {
  assert.equal(normalizeHistoryProgress(32.7), 33);
  assert.equal(normalizeHistoryProgress(120), 100);
  assert.equal(normalizeHistoryProgress(-5), 0);
  assert.equal(normalizeHistoryProgress(null), null);
  assert.equal(normalizeHistoryProgress(Number.NaN), null);
});

test('history batch persists timestamp metadata only and never message bodies', async () => {
  let sql = '';
  let params: unknown[] = [];
  const queryFn: QueryFn = async (text, values) => { sql = text; params = values ?? []; return { rows: [] }; };
  const event = {
    messages: [{ messageTimestamp: 1_710_000_000, message: { conversation: 'private chat content' } }],
    progress: 40,
  } as unknown as BaileysEventMap['messaging-history.set'];

  await recordHistoryBatch('WAPI-TEST01', event, queryFn, log);

  assert.match(sql, /history_latest_message_at/);
  assert.match(sql, /history_sync_progress/);
  assert.equal(params[0], 'WAPI-TEST01');
  assert.equal(params[1] instanceof Date, true);
  assert.equal(params[2], 40);
  assert.equal(JSON.stringify(params).includes('private chat content'), false);
});

test('history completion distinguishes explicit 100% from inferred completion', async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const queryFn: QueryFn = async (sql, params) => { calls.push({ sql, params: params ?? [] }); return { rows: [] }; };

  await recordHistoryStatus('WAPI-TEST01', { status: 'complete', explicit: true, syncType: 0 } as BaileysEventMap['messaging-history.status'], queryFn, log);
  await recordHistoryStatus('WAPI-TEST01', { status: 'complete', explicit: false, syncType: 0 } as BaileysEventMap['messaging-history.status'], queryFn, log);
  await recordHistoryStatus('WAPI-TEST01', { status: 'paused', explicit: false, syncType: 0 } as BaileysEventMap['messaging-history.status'], queryFn, log);

  assert.equal(calls[0]?.params[1], 'completed');
  assert.equal(calls[0]?.params[2], true);
  assert.equal(calls[1]?.params[2], false);
  assert.equal(calls[2]?.params[1], 'paused');
});
