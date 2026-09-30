import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WASocket } from '@whiskeysockets/baileys';
import type { Logger } from 'winston';
import { CommandFailure, executeCommand, Reschedule, statusAudience, type CommandContext } from './commands';

const log = { info: () => undefined, debug: () => undefined, warn: () => undefined } as unknown as Logger;

function ctx(over: { business?: boolean; rows?: Array<Record<string, unknown>>; persona?: Record<string, unknown> | null; now?: Date; consentStatus?: string } = {}) {
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const track = (fn: string, ret?: unknown) => async (...args: unknown[]) => { calls.push({ fn, args }); return ret; };
  const sock = {
    user: { id: '628111:5@s.whatsapp.net', name: 'Toko' },
    getBusinessProfile: async () => (over.business ? { description: 'x' } : undefined),
    updateBussinesProfile: track('updateBussinesProfile'),
    productCreate: track('productCreate', { id: 'p2', name: 'B', price: 10_000_000 }),
    productDelete: track('productDelete', { deleted: 1 }),
    sendMessage: async (...args: unknown[]) => { calls.push({ fn: 'sendMessage', args }); return { key: { id: 'S1' } }; },
  } as unknown as WASocket;
  const persona = over.persona === undefined ? { seed: 's', timezone: 'Asia/Jakarta', wake_hour: 6, sleep_hour: 23, delay_min_ms: 1000, delay_max_ms: 2000, burst_size: 8, rest_min_ms: 240000, rest_max_ms: 600000, typing_ms_per_char: 50, always_on: true } : over.persona;
  const queryFn = async (text: string) => {
    if (text.includes('device_personas')) return { rows: persona ? [persona] : [] };
    if (text.includes('SELECT tenant_id FROM devices')) return { rows: [{ tenant_id: 'tenant-1' }] };
    if (text.includes('FROM recipient_preferences')) return { rows: over.consentStatus === 'opted_out' ? [{ status: 'opted_out' }] : over.consentStatus === 'none' ? [] : [{ status: 'opted_in' }] };
    return { rows: over.rows ?? [] };
  };
  const presence = { ensureOnline: async () => { calls.push({ fn: 'online', args: [] }); }, afterSend: async () => { calls.push({ fn: 'afterSend', args: [] }); } };
  const context: CommandContext = { sock, queryFn, deviceKey: 'WAPI-X', deviceId: 'dev-1', presence, log, random: () => 0,
    consentLocks: async (_tenant, _recipients, work) => work(), ...(over.now ? { now: () => over.now! } : {}) };
  return { context, calls };
}

test('profile.get reports name, About, photo and whether the number is a Business account', async () => {
  const { context } = ctx({ business: true });
  const sock = context.sock as unknown as Record<string, unknown>;
  sock['fetchStatus'] = async () => [{ status: { status: 'Buka 09-17' } }];
  sock['profilePictureUrl'] = async () => 'https://pps.whatsapp.net/x.jpg';
  const out = await executeCommand('profile.get', {}, context) as { name: string; about: string; picture_url: string; is_business: boolean; phone: string };
  assert.equal(out.name, 'Toko');
  assert.equal(out.about, 'Buka 09-17');
  assert.equal(out.picture_url, 'https://pps.whatsapp.net/x.jpg');
  assert.equal(out.is_business, true);
  assert.equal(out.phone, '628111');
});

test('profile.get still answers when the About text or photo is unavailable', async () => {
  const { context } = ctx({ business: false });
  const sock = context.sock as unknown as Record<string, unknown>;
  sock['fetchStatus'] = async () => { throw new Error('nope'); };
  sock['profilePictureUrl'] = async () => { throw new Error('item-not-found'); };
  const out = await executeCommand('profile.get', {}, context) as { about: unknown; picture_url: unknown; is_business: boolean };
  assert.equal(out.about, null);
  assert.equal(out.picture_url, null);
  assert.equal(out.is_business, false);
});

test('profile.update changes name and About on any number', async () => {
  const { context, calls } = ctx({ business: false });
  const sock = context.sock as unknown as Record<string, unknown>;
  sock['updateProfileName'] = async (...a: unknown[]) => { calls.push({ fn: 'name', args: a }); };
  sock['updateProfileStatus'] = async (...a: unknown[]) => { calls.push({ fn: 'about', args: a }); };
  sock['fetchStatus'] = async () => [];
  sock['profilePictureUrl'] = async () => { throw new Error('none'); };
  await executeCommand('profile.update', { name: 'Toko Baru', about: 'Halo' }, context);
  assert.deepEqual(calls.filter((c) => c.fn === 'name' || c.fn === 'about').map((c) => [c.fn, c.args[0]]), [['name', 'Toko Baru'], ['about', 'Halo']]);
});

test('business fields are refused on a regular WhatsApp number', async () => {
  const { context } = ctx({ business: false });
  await assert.rejects(() => executeCommand('profile.update', { business: { description: 'x' } }, context), (e: unknown) => e instanceof CommandFailure && e.code === 'NOT_BUSINESS');
});

test('business.update converts opening hours to minutes', async () => {
  const { context, calls } = ctx({ business: true });
  const sock = context.sock as unknown as Record<string, unknown>;
  sock['fetchStatus'] = async () => [];
  sock['profilePictureUrl'] = async () => { throw new Error('none'); };
  await executeCommand('profile.update', { business: { hours: { timezone: 'Asia/Jakarta', days: [{ day: 'mon', mode: 'specific_hours', open: '08:30', close: '17:00' }, { day: 'sun', mode: 'appointment_only' }] } } }, context);
  const arg = calls.find((c) => c.fn === 'updateBussinesProfile')!.args[0] as { hours: { days: Array<Record<string, string>> } };
  assert.equal(arg.hours.days[0]!['openTimeInMinutes'], '510');
  assert.equal(arg.hours.days[0]!['closeTimeInMinutes'], '1020');
  assert.equal(arg.hours.days[1]!['mode'], 'appointment_only');
});

test('profile.picture sends a decoded image, a url, or removes the photo', async () => {
  const { context, calls } = ctx({ business: false });
  const sock = context.sock as unknown as Record<string, unknown>;
  sock['updateProfilePicture'] = async (...a: unknown[]) => { calls.push({ fn: 'pic', args: a }); };
  sock['removeProfilePicture'] = async (...a: unknown[]) => { calls.push({ fn: 'rm', args: a }); };
  sock['fetchStatus'] = async () => [];
  sock['profilePictureUrl'] = async () => { throw new Error('none'); };
  await executeCommand('profile.picture', { image_base64: Buffer.from('jpegbytes').toString('base64') }, context);
  await executeCommand('profile.picture', { image_url: 'https://cdn.example/a.jpg' }, context);
  await executeCommand('profile.picture', {}, context);
  const pics = calls.filter((c) => c.fn === 'pic');
  assert.equal(Buffer.isBuffer(pics[0]!.args[1]), true);
  assert.deepEqual(pics[1]!.args[1], { url: 'https://cdn.example/a.jpg' });
  assert.equal(calls.filter((c) => c.fn === 'rm').length, 1);
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

test('status.post refuses the full publish when an explicit audience member lacks consent', async () => {
  const { context, calls } = ctx({ rows: [], consentStatus: 'none' });
  await assert.rejects(
    () => executeCommand('status.post', { kind: 'text', text: 'Promo!', audience: 'list', numbers: ['6281234567890'] }, context),
    (error: unknown) => error instanceof CommandFailure && error.code === 'RECIPIENT_CONSENT_REQUIRED',
  );
  assert.equal(calls.some((call) => call.fn === 'sendMessage'), false);
});

test('a profile query WhatsApp never answers fails as WA_TIMEOUT instead of looking empty', async () => {
  const { context } = ctx({ business: true });
  (context.sock as unknown as { updateProfileName: () => Promise<never> }).updateProfileName = () => new Promise(() => undefined);
  await assert.rejects(() => executeCommand('profile.update', { name: 'X' }, { ...context, deadlineMs: 30 }), { code: 'WA_TIMEOUT' });
});
