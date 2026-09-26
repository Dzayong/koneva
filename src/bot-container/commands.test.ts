import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WASocket } from '@whiskeysockets/baileys';
import type { Logger } from 'winston';
import { CommandFailure, executeCommand, fromWirePrice, Reschedule, statusAudience, toWirePrice, type CommandContext } from './commands';

const log = { info: () => undefined, debug: () => undefined, warn: () => undefined } as unknown as Logger;

function ctx(over: { business?: boolean; rows?: Array<Record<string, unknown>>; persona?: Record<string, unknown> | null; now?: Date } = {}) {
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const track = (fn: string, ret?: unknown) => async (...args: unknown[]) => { calls.push({ fn, args }); return ret; };
  const sock = {
    user: { id: '628111:5@s.whatsapp.net', name: 'Toko' },
    getBusinessProfile: async () => (over.business ? { description: 'x' } : undefined),
    updateBussinesProfile: track('updateBussinesProfile'),
    getCatalog: async () => ({ products: [{ id: 'p1', name: 'A', price: 25_000_000 }], nextPageCursor: 'c2' }),
    productCreate: track('productCreate', { id: 'p2', name: 'B', price: 10_000_000 }),
    productDelete: track('productDelete', { deleted: 1 }),
    sendMessage: async (...args: unknown[]) => { calls.push({ fn: 'sendMessage', args }); return { key: { id: 'S1' } }; },
  } as unknown as WASocket;
  const persona = over.persona === undefined ? { seed: 's', timezone: 'Asia/Jakarta', wake_hour: 6, sleep_hour: 23, delay_min_ms: 1000, delay_max_ms: 2000, burst_size: 8, rest_min_ms: 240000, rest_max_ms: 600000, typing_ms_per_char: 50, always_on: true } : over.persona;
  const queryFn = async (text: string) => {
    if (text.includes('device_personas')) return { rows: persona ? [persona] : [] };
    return { rows: over.rows ?? [] };
  };
  const presence = { ensureOnline: async () => { calls.push({ fn: 'online', args: [] }); }, afterSend: async () => { calls.push({ fn: 'afterSend', args: [] }); } };
  const context: CommandContext = { sock, queryFn, deviceKey: 'WAPI-X', deviceId: 'dev-1', presence, log, random: () => 0, ...(over.now ? { now: () => over.now! } : {}) };
  return { context, calls };
}

test('prices are converted to WhatsApp wire units and back', () => {
  assert.equal(toWirePrice(25_000), 25_000_000);
  assert.equal(fromWirePrice(25_000_000), 25_000);
});

test('catalog and product commands refuse a regular WhatsApp number', async () => {
  const { context } = ctx({ business: false });
  await assert.rejects(() => executeCommand('catalog.list', {}, context), (e: unknown) => e instanceof CommandFailure && e.code === 'NOT_BUSINESS');
  await assert.rejects(() => executeCommand('product.delete', { id: 'p' }, context), { code: 'NOT_BUSINESS' });
});

test('business.get reports whether the number is a Business account', async () => {
  assert.deepEqual(await executeCommand('business.get', {}, ctx({ business: false }).context), { is_business: false, profile: null });
  assert.equal((await executeCommand('business.get', {}, ctx({ business: true }).context) as { is_business: boolean }).is_business, true);
});

test('catalog.list shows prices in whole rupiah and passes the cursor on', async () => {
  const out = await executeCommand('catalog.list', { limit: 5 }, ctx({ business: true }).context) as { products: Array<{ price: number }>; next_cursor: string };
  assert.equal(out.products[0]!.price, 25_000);
  assert.equal(out.next_cursor, 'c2');
});

test('product.create sends wire-scaled price and image uploads', async () => {
  const { context, calls } = ctx({ business: true });
  await executeCommand('product.create', { name: 'B', price: 10_000, image_urls: ['https://x.example/a.jpg'], origin_country: 'ID' }, context);
  const args = calls.find((c) => c.fn === 'productCreate')!.args[0] as { price: number; images: Array<{ url: string }>; originCountryCode: string };
  assert.equal(args.price, 10_000_000);
  assert.deepEqual(args.images, [{ url: 'https://x.example/a.jpg' }]);
  assert.equal(args.originCountryCode, 'ID');
});

test('business.update converts opening hours to minutes', async () => {
  const { context, calls } = ctx({ business: true });
  await executeCommand('business.update', { hours: { timezone: 'Asia/Jakarta', days: [{ day: 'mon', mode: 'specific_hours', open: '08:30', close: '17:00' }, { day: 'sun', mode: 'appointment_only' }] } }, context);
  const arg = calls.find((c) => c.fn === 'updateBussinesProfile')!.args[0] as { hours: { days: Array<Record<string, string>> } };
  assert.equal(arg.hours.days[0]!['openTimeInMinutes'], '510');
  assert.equal(arg.hours.days[0]!['closeTimeInMinutes'], '1020');
  assert.equal(arg.hours.days[1]!['mode'], 'appointment_only');
});

test('status audience is people the number actually talked to, deduplicated and validated', async () => {
  const { context } = ctx({ rows: [{ n: '6281111' + '0001' }, { n: '+62 8111 10001' }, { n: 'abc' }, { n: '12' }] });
  const jids = await statusAudience(context, { kind: 'text', text: 'hi', audience: 'chatted' });
  assert.deepEqual(jids, ['62811110001@s.whatsapp.net']);
});

test('status with nobody to show it to fails with NO_AUDIENCE', async () => {
  await assert.rejects(() => statusAudience(ctx().context, { kind: 'text', text: 'hi', audience: 'chatted' }), { code: 'NO_AUDIENCE' });
});

test('status.post goes online, posts to status@broadcast including the owner, then lets the number rest', async () => {
  const { context, calls } = ctx({ rows: [{ n: '6281234567890' }] });
  const out = await executeCommand('status.post', { kind: 'text', text: 'Promo!', background: '#1d4ed8', audience: 'chatted' }, context) as { message_id: string; recipients: number };
  assert.equal(out.recipients, 1);
  const order = calls.map((c) => c.fn);
  assert.deepEqual(order.filter((f) => ['online', 'sendMessage', 'afterSend'].includes(f)), ['online', 'sendMessage', 'afterSend']);
  const send = calls.find((c) => c.fn === 'sendMessage')!;
  assert.equal(send.args[0], 'status@broadcast');
  assert.deepEqual((send.args[2] as { statusJidList: string[] }).statusJidList.sort(), ['628111@s.whatsapp.net', '6281234567890@s.whatsapp.net']);
});

test('status.post outside the number\'s active hours is postponed, not posted', async () => {
  const persona = { seed: 's', timezone: 'UTC', wake_hour: 8, sleep_hour: 20, delay_min_ms: 1000, delay_max_ms: 2000, burst_size: 8, rest_min_ms: 240000, rest_max_ms: 600000, typing_ms_per_char: 50, always_on: false };
  const { context, calls } = ctx({ rows: [{ n: '6281234567890' }], persona, now: new Date('2026-09-26T02:00:00Z') });
  await assert.rejects(() => executeCommand('status.post', { kind: 'text', text: 'x', audience: 'chatted' }, context), (e: unknown) => e instanceof Reschedule && e.delayMs > 5 * 3_600_000);
  assert.equal(calls.some((c) => c.fn === 'sendMessage'), false);
});

test('a catalog request WhatsApp never answers fails as CATALOG_TIMEOUT instead of looking like an empty catalog', async () => {
  const { context } = ctx({ business: true });
  (context.sock as unknown as { getCatalog: () => Promise<never> }).getCatalog = () => new Promise(() => undefined);
  await assert.rejects(() => executeCommand('catalog.list', {}, { ...context, deadlineMs: 30 }), { code: 'CATALOG_TIMEOUT' });
});
