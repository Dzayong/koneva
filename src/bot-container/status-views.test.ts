import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Logger } from 'winston';
import { recordStatusView } from './status-views';
import { toMessageContent } from './queue';

const log = { debug: () => undefined } as unknown as Logger;
function db() {
  const calls: unknown[][] = [];
  return { calls, queryFn: async (_t: string, p?: unknown[]) => { calls.push(p ?? []); return { rows: [{ viewer: 'x' }] }; } };
}
const key = (over: Record<string, unknown> = {}) => ({ remoteJid: 'status@broadcast', fromMe: true, id: 'ST1', ...over });

test('a read receipt on our own status is recorded once per viewer', async () => {
  const { calls, queryFn } = db();
  const ok = await recordStatusView({ key: key(), receipt: { userJid: '6281234567890@s.whatsapp.net', readTimestamp: 1 } }, 'WAPI-X', queryFn, log);
  assert.equal(ok, true);
  assert.deepEqual(calls[0], ['WAPI-X', 'ST1', '6281234567890']);
});

test('lid viewers are stored distinguishably and device suffixes are dropped', async () => {
  const { calls, queryFn } = db();
  await recordStatusView({ key: key(), receipt: { userJid: '2042351:12@lid', readTimestamp: 1 } }, 'WAPI-X', queryFn, log);
  assert.equal(calls[0]![2], 'lid:2042351');
});

test('deliveries, other chats and statuses from other people are ignored', async () => {
  const { calls, queryFn } = db();
  assert.equal(await recordStatusView({ key: key(), receipt: { userJid: '628@s.whatsapp.net' } }, 'D', queryFn, log), false);
  assert.equal(await recordStatusView({ key: key({ remoteJid: '628@s.whatsapp.net' }), receipt: { userJid: '628@s.whatsapp.net', readTimestamp: 1 } }, 'D', queryFn, log), false);
  assert.equal(await recordStatusView({ key: key({ fromMe: false }), receipt: { userJid: '628@s.whatsapp.net', readTimestamp: 1 } }, 'D', queryFn, log), false);
  assert.equal(calls.length, 0);
});

test('media messages keep the file address in media_url and the text as caption', () => {
  const image = toMessageContent({ type: 'image', content: 'Promo, cek https://toko.example/promo', mediaUrl: 'https://cdn.example/a.jpg' });
  assert.deepEqual(image, { image: { url: 'https://cdn.example/a.jpg' }, caption: 'Promo, cek https://toko.example/promo' });
  assert.deepEqual(toMessageContent({ type: 'image', content: '', mediaUrl: 'https://cdn.example/a.jpg' }), { image: { url: 'https://cdn.example/a.jpg' } });
});

test('older media rows that stored the address in content still send', () => {
  assert.deepEqual(toMessageContent({ type: 'image', content: 'https://cdn.example/old.jpg' }), { image: { url: 'https://cdn.example/old.jpg' } });
  assert.deepEqual(toMessageContent({ type: 'text', content: 'Halo https://a.example' }), { text: 'Halo https://a.example' });
});
