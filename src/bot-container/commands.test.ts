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

test('WhatsApp group listing returns group and community summaries without participant phone numbers', async () => {
  const { context } = ctx();
  const sock = context.sock as unknown as Record<string, unknown>;
  sock['groupFetchAllParticipating'] = async () => ({
    'group@g.us': { id: 'group@g.us', subject: 'Komunitas RT', size: 12, desc: 'Info warga', participants: [{ id: '628111@s.whatsapp.net' }] },
    'child@g.us': { id: 'child@g.us', subject: 'Keamanan', size: 8, linkedParent: 'group@g.us', participants: [{ id: '628222@s.whatsapp.net' }] },
  });
  sock['communityFetchAllParticipating'] = async () => ({
    'group@g.us': { id: 'group@g.us', subject: 'Komunitas RT', size: 12, desc: 'Info warga', isCommunity: true, participants: [{ id: '628111@s.whatsapp.net' }] },
  });
  const result = await executeCommand('whatsapp.groups.list', {}, context) as Array<Record<string, unknown>>;
  assert.equal(result.length, 2);
  assert.equal(result[0]?.['id'], 'child@g.us');
  assert.equal(result[0]?.['parent_community_jid'], 'group@g.us');
  assert.equal(result[1]?.['is_community'], true);
  assert.equal(JSON.stringify(result).includes('628111'), false);
});

test('WhatsApp channel lookup returns public channel metadata only', async () => {
  const { context } = ctx();
  const sock = context.sock as unknown as Record<string, unknown>;
  sock['newsletterMetadata'] = async (type: string, key: string) => {
    assert.equal(type, 'invite');
    assert.equal(key, 'invite-code');
    return { id: 'channel@newsletter', name: 'Kabar Toko', description: 'Info terbaru', subscribers: 42, verification: 'VERIFIED' };
  };
  const result = await executeCommand('whatsapp.channel.lookup', { lookup: 'invite-code' }, context) as Record<string, unknown>;
  assert.equal(result['name'], 'Kabar Toko');
  assert.equal(result['subscribers'], 42);
  assert.equal(result['verification'], 'VERIFIED');
});

test('group and community management actions call Baileys and re-check transmission permission', async () => {
  const { context, calls } = ctx();
  const sock = context.sock as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  for (const name of ['groupCreate', 'groupUpdateSubject', 'groupUpdateDescription', 'groupLeave', 'groupParticipantsUpdate', 'communityCreate', 'communityLeave', 'communityLinkGroup']) {
    sock[name] = async (...args) => { calls.push({ fn: name, args }); return { id: '120363000000-123456@g.us' }; };
  }
  let guards = 0;
  context.assertMayTransmit = async () => { guards += 1; };
  await executeCommand('whatsapp.group.create', { name: 'Tim', participants: ['+6281234567890'] }, context);
  await executeCommand('whatsapp.group.members', { jid: '120363000000-123456@g.us', action: 'add', participants: ['6281234567890'] }, context);
  await executeCommand('whatsapp.community.link-group', { community_jid: '120363000000-123456@g.us', group_jid: '120363000001-123456@g.us', action: 'link' }, context);
  assert.equal(guards, 3);
  assert.deepEqual(calls.find(call => call.fn === 'groupCreate')?.args, ['Tim', ['6281234567890@s.whatsapp.net']]);
  assert.deepEqual(calls.find(call => call.fn === 'groupParticipantsUpdate')?.args, ['120363000000-123456@g.us', ['6281234567890@s.whatsapp.net'], 'add']);
  assert.deepEqual(calls.find(call => call.fn === 'communityLinkGroup')?.args, ['120363000001-123456@g.us', '120363000000-123456@g.us']);
});

test('community creation treats a missing WhatsApp confirmation as failure', async () => {
  const { context } = ctx();
  const sock = context.sock as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  sock['communityCreate'] = async () => null;
  await assert.rejects(
    () => executeCommand('whatsapp.community.create', { name: 'Komunitas', description: '' }, context),
    (error: unknown) => error instanceof CommandFailure && error.code === 'COMMUNITY_CREATE_UNCONFIRMED',
  );
});

test('group details expose participants and supported settings without phone history', async () => {
  const { context, calls } = ctx();
  const sock = context.sock as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  sock['groupMetadata'] = async (...args: unknown[]) => ({
    id: String(args[0]), subject: 'Tim', desc: 'Info', creation: 1_700_000_000, ownerPn: '628100@s.whatsapp.net', announce: true,
    restrict: false, memberAddMode: true, joinApprovalMode: true, ephemeralDuration: 86_400,
    participants: [{ id: '628100@s.whatsapp.net', phoneNumber: '628100@s.whatsapp.net', name: 'Dzaki', admin: 'superadmin' }, { id: '628200@s.whatsapp.net' }],
  });
  sock['profilePictureUrl'] = async () => 'https://media.example/group.jpg';
  sock['groupInviteCode'] = async (...args: unknown[]) => { calls.push({ fn: 'groupInviteCode', args }); return 'invite-code'; };
  sock['groupRevokeInvite'] = async (...args: unknown[]) => { calls.push({ fn: 'groupRevokeInvite', args }); return 'new-code'; };
  sock['groupSettingUpdate'] = async (...args: unknown[]) => { calls.push({ fn: 'groupSettingUpdate', args }); };
  sock['groupMemberAddMode'] = async (...args: unknown[]) => { calls.push({ fn: 'groupMemberAddMode', args }); };
  sock['groupJoinApprovalMode'] = async (...args: unknown[]) => { calls.push({ fn: 'groupJoinApprovalMode', args }); };
  sock['groupToggleEphemeral'] = async (...args: unknown[]) => { calls.push({ fn: 'groupToggleEphemeral', args }); };
  sock['groupRequestParticipantsList'] = async () => [{ jid: '628300@s.whatsapp.net', request_time: '123' }];
  sock['groupRequestParticipantsUpdate'] = async (...args: unknown[]) => { calls.push({ fn: 'groupRequestParticipantsUpdate', args }); return []; };

  const details = await executeCommand('whatsapp.group.details', { jid: '120363000000-123456@g.us' }, context) as { participants: Array<{ name: string | null; role: string }>; join_approval: boolean; image_url: string };
  assert.equal(details.participants[0]?.name, 'Dzaki');
  assert.equal(details.participants[0]?.role, 'owner');
  assert.equal(details.participants[1]?.role, 'member');
  assert.equal(details.join_approval, true);
  assert.equal(details.image_url, 'https://media.example/group.jpg');
  assert.equal((await executeCommand('whatsapp.group.invite', { jid: '120363000000-123456@g.us' }, context) as { code: string }).code, 'invite-code');
  assert.equal((await executeCommand('whatsapp.group.join-requests', { jid: '120363000000-123456@g.us' }, context) as Array<{ id: string }>)[0]?.id, '628300@s.whatsapp.net');

  let guards = 0;
  context.assertMayTransmit = async () => { guards += 1; };
  sock['updateProfilePicture'] = async (...args: unknown[]) => { calls.push({ fn: 'updateProfilePicture', args }); };
  await executeCommand('whatsapp.group.picture', { jid: 'g', image_base64: Buffer.from('photo').toString('base64') }, context);
  await executeCommand('whatsapp.group.invite.revoke', { jid: '120363000000-123456@g.us' }, context);
  await executeCommand('whatsapp.group.settings', { jid: 'g', announcement_only: true, restricted: true, member_add_mode: 'admin_add', join_approval: true, ephemeral_duration: 604_800 }, context);
  await executeCommand('whatsapp.group.join-requests.update', { jid: 'g', action: 'approve', participants: ['628300@s.whatsapp.net'] }, context);
  assert.equal(guards, 4);
  assert.deepEqual(calls.find((call) => call.fn === 'updateProfilePicture')?.args, ['g', Buffer.from('photo')]);
  assert.deepEqual(calls.find((call) => call.fn === 'groupSettingUpdate')?.args, ['g', 'announcement']);
  assert.deepEqual(calls.find((call) => call.fn === 'groupToggleEphemeral')?.args, ['g', 604_800]);
  assert.deepEqual(calls.find((call) => call.fn === 'groupRequestParticipantsUpdate')?.args, ['g', ['628300@s.whatsapp.net'], 'approve']);
});

test('channel follow and create return metadata and require transmission permission', async () => {
  const { context, calls } = ctx();
  const sock = context.sock as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  sock['newsletterMetadata'] = async (...args) => { calls.push({ fn: 'newsletterMetadata', args }); return { id: 'channel@newsletter', name: 'Info', invite: 'invite-code' }; };
  sock['newsletterFollow'] = async (...args) => { calls.push({ fn: 'newsletterFollow', args }); return {}; };
  sock['newsletterCreate'] = async (...args) => { calls.push({ fn: 'newsletterCreate', args }); return { id: 'channel@newsletter', name: 'Toko', invite: 'invite-code' }; };
  let guards = 0;
  context.assertMayTransmit = async () => { guards += 1; };
  const followed = await executeCommand('whatsapp.channel.follow', { lookup: 'invite-code', isJid: false }, context) as Record<string, unknown>;
  const created = await executeCommand('whatsapp.channel.create', { name: 'Toko', description: 'Info' }, context) as Record<string, unknown>;
  assert.equal(followed['id'], 'channel@newsletter');
  assert.equal(created['invite'], 'invite-code');
  assert.equal(guards, 2);
  assert.deepEqual(calls.find(call => call.fn === 'newsletterFollow')?.args, ['channel@newsletter']);
  assert.deepEqual(calls.find(call => call.fn === 'newsletterCreate')?.args, ['Toko', 'Info']);
});

test('channel post sends a text, photo, or video to the selected channel after the write guard', async () => {
  const { context, calls } = ctx();
  let guards = 0;
  context.assertMayTransmit = async () => { guards += 1; };
  await executeCommand('whatsapp.channel.post', { jid: 'channel@newsletter', kind: 'text', text: 'Info toko' }, context);
  await executeCommand('whatsapp.channel.post', { jid: 'channel@newsletter', kind: 'image', media_url: 'https://example.com/promo.jpg', caption: 'Promo' }, context);
  await executeCommand('whatsapp.channel.post', { jid: 'channel@newsletter', kind: 'video', media_url: 'https://example.com/info.mp4' }, context);
  const sent = calls.filter((call) => call.fn === 'sendMessage');
  assert.equal(guards, 3);
  assert.deepEqual(sent.map((call) => call.args), [
    ['channel@newsletter', { text: 'Info toko' }],
    ['channel@newsletter', { image: { url: 'https://example.com/promo.jpg' }, caption: 'Promo' }],
    ['channel@newsletter', { video: { url: 'https://example.com/info.mp4' } }],
  ]);
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

test('status audience can target all saved workspace contacts', async () => {
  const { context } = ctx({ rows: [{ n: '+62 8111 10001' }, { n: '62811110002' }, { n: 'invalid' }] });
  const jids = await statusAudience(context, { kind: 'text', text: 'hi', audience: 'all_contacts' });
  assert.deepEqual(jids.sort(), ['62811110001@s.whatsapp.net', '62811110002@s.whatsapp.net']);
});

test('status audience can exclude selected saved contacts', async () => {
  const { context } = ctx({ rows: [{ n: '62811110001' }, { n: '62811110002' }] });
  const jids = await statusAudience(context, { kind: 'text', text: 'hi', audience: 'contacts_except', numbers: ['+62 8111 10001'] });
  assert.deepEqual(jids, ['62811110002@s.whatsapp.net']);
});

test('status audience refuses more than 500 saved contacts instead of silently truncating', async () => {
  const rows = Array.from({ length: 501 }, (_, i) => ({ n: `6281234${String(i).padStart(6, '0')}` }));
  await assert.rejects(
    () => statusAudience(ctx({ rows }).context, { kind: 'text', text: 'hi', audience: 'all_contacts' }),
    { code: 'AUDIENCE_TOO_LARGE' },
  );
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

test('status.post is not blocked by the removed per-device active hours', async () => {
  const persona = { seed: 's', timezone: 'UTC', wake_hour: 8, sleep_hour: 20, delay_min_ms: 1000, delay_max_ms: 2000, burst_size: 8, rest_min_ms: 240000, rest_max_ms: 600000, typing_ms_per_char: 50, always_on: false };
  const { context, calls } = ctx({ rows: [{ n: '6281234567890' }], persona, now: new Date('2026-09-26T02:00:00Z') });
  await executeCommand('status.post', { kind: 'text', text: 'x', audience: 'chatted' }, context);
  assert.equal(calls.some((c) => c.fn === 'sendMessage'), true);
});

test('status.post refuses the full publish when an explicit audience member lacks consent', async () => {
  const { context, calls } = ctx({ rows: [], consentStatus: 'none' });
  await assert.rejects(
    () => executeCommand('status.post', { kind: 'text', text: 'Promo!', audience: 'list', numbers: ['6281234567890'] }, context),
    (error: unknown) => error instanceof CommandFailure && error.code === 'RECIPIENT_CONSENT_REQUIRED',
  );
  assert.equal(calls.some((call) => call.fn === 'sendMessage'), false);
});

test('status.post does not bypass consent when targeting all saved contacts', async () => {
  const { context, calls } = ctx({ rows: [{ n: '6281234567890' }], consentStatus: 'none' });
  await assert.rejects(
    () => executeCommand('status.post', { kind: 'text', text: 'Promo!', audience: 'all_contacts' }, context),
    (error: unknown) => error instanceof CommandFailure && error.code === 'RECIPIENT_CONSENT_REQUIRED',
  );
  assert.equal(calls.some((call) => call.fn === 'sendMessage'), false);
});

test('a profile query WhatsApp never answers fails as WA_TIMEOUT instead of looking empty', async () => {
  const { context } = ctx({ business: true });
  (context.sock as unknown as { updateProfileName: () => Promise<never> }).updateProfileName = () => new Promise(() => undefined);
  await assert.rejects(() => executeCommand('profile.update', { name: 'X' }, { ...context, deadlineMs: 30 }), { code: 'WA_TIMEOUT' });
});
