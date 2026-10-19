import { jidNormalizedUser, type WASocket } from '@whiskeysockets/baileys';
import type { Logger } from 'winston';
import type { CommandType, ProfilePicturePayload, ProfileUpdate, StatusPayload } from '../shared/commands';
import { getOrCreatePersona, isWithinPersonaWindow, msUntilWindowOpens } from '../shared/persona';
import type { PresenceRoutine } from './presence';
import { getStoredRecipientConsent, normalizeRecipientNumber, withRecipientConsentLocks } from '../shared/recipient-consent';

type QueryFn = (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

export interface CommandContext {
  sock: WASocket;
  queryFn: QueryFn;
  deviceKey: string;
  deviceId: string;
  presence?: Pick<PresenceRoutine, 'ensureOnline' | 'afterSend'> | undefined;
  log: Logger;
  random?: () => number;
  now?: () => Date;
  /** Test hook: shorter give-up time for WhatsApp queries. */
  deadlineMs?: number;
  /**
   * Called immediately before anything is WRITTEN to WhatsApp (status post, profile edits). Throws a CommandFailure when the workspace is
   * suspended or the number is paused/banned. Reads (profile.get) do not call it.
   */
  assertMayTransmit?: () => Promise<void>;
  consentLocks?: <T>(tenantId: string, recipients: string[], work: () => Promise<T>) => Promise<T>;
}

/** Failure with a stable code; the runner stores it as "CODE: message" for the API to translate. */
export class CommandFailure extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

/** Not an error: the command must wait (e.g. the number is asleep). The runner puts it back in the queue. */
export class Reschedule extends Error {
  constructor(readonly delayMs: number, readonly reason: string) { super(reason); }
}

/**
 * Baileys logs "timed out waiting for message" and then resolves with an EMPTY result, so a query WhatsApp
 * never answered can look like real-but-empty data. Give up early and say so instead.
 */
export const COMMAND_DEADLINE_MS = 15_000;
async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new CommandFailure('WA_TIMEOUT', 'WhatsApp did not answer in time')), ms); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

const ownJid = (sock: WASocket): string => {
  const id = sock.user?.id;
  if (!id) throw new CommandFailure('NOT_CONNECTED', 'The number is not connected');
  return jidNormalizedUser(id);
};

async function businessProfile(sock: WASocket) {
  const profile = await sock.getBusinessProfile(ownJid(sock)).catch(() => undefined);
  return profile ?? undefined;
}

async function requireBusiness(sock: WASocket) {
  const profile = await businessProfile(sock);
  if (!profile) throw new CommandFailure('NOT_BUSINESS', 'This number is a regular WhatsApp account. The business profile needs WhatsApp Business.');
  return profile;
}

const toMinutes = (hhmm: string): string => {
  const [h = '0', m = '0'] = hhmm.split(':');
  return String(Number(h) * 60 + Number(m));
};

/** Resolve status viewers from workspace contacts, conversation history, or an explicit selection. */
export async function statusAudience(ctx: CommandContext, p: StatusPayload): Promise<string[]> {
  const numbers = new Set<string>();
  if (p.audience === 'list') {
    for (const n of p.numbers ?? []) numbers.add(n.replace(/^\+/, ''));
  } else if (p.audience === 'all_contacts' || p.audience === 'contacts_except') {
    const excluded = new Set((p.audience === 'contacts_except' ? p.numbers ?? [] : []).map((n) => n.replace(/\D/g, '')));
    const { rows } = await ctx.queryFn(
      `SELECT DISTINCT regexp_replace(c.phone_number, '[^0-9]', '', 'g') AS n
       FROM contacts c JOIN devices d ON d.tenant_id = c.tenant_id
       WHERE d.id = $1 AND d.device_key = $2
         AND NOT (regexp_replace(c.phone_number, '[^0-9]', '', 'g') = ANY($3::text[]))
       ORDER BY n LIMIT 501`, [ctx.deviceId, ctx.deviceKey, [...excluded]],
    );
    if (rows.length > 500) throw new CommandFailure('AUDIENCE_TOO_LARGE', 'Status hanya dapat dibagikan ke maksimal 500 kontak sekaligus.');
    for (const r of rows) {
      const n = String(r['n'] ?? '').replace(/\D/g, '');
      if (/^[1-9]\d{6,14}$/.test(n) && !excluded.has(n)) numbers.add(n);
    }
  } else {
    const { rows } = await ctx.queryFn(
      `SELECT DISTINCT CASE WHEN direction = 'outbound' THEN to_number ELSE from_number END AS n
       FROM messages
       WHERE device_key = $1 AND created_at > now() - interval '90 days'
         AND (direction = 'inbound' OR status IN ('sent', 'delivered', 'read'))
       LIMIT 500`, [ctx.deviceKey],
    );
    for (const r of rows) {
      const n = String(r['n'] ?? '').replace(/\D/g, '');
      if (/^[1-9]\d{6,14}$/.test(n)) numbers.add(n);
    }
  }
  if (numbers.size === 0) throw new CommandFailure('NO_AUDIENCE', 'Tidak ada kontak yang cocok dengan pilihan audiens status ini.');
  return [...numbers].map((n) => `${n}@s.whatsapp.net`);
}

async function postStatus(ctx: CommandContext, p: StatusPayload) {
  const persona = await getOrCreatePersona(ctx.deviceId, ctx.queryFn);
  const now = (ctx.now ?? (() => new Date()))();
  if (!isWithinPersonaWindow(persona, now)) {
    // Wait for the number's day to start, plus a random 0-20 minutes so it does not post at the exact opening minute.
    throw new Reschedule(msUntilWindowOpens(persona, now) + Math.round((ctx.random ?? Math.random)() * 20 * 60_000), 'outside_active_hours');
  }
  const requestedRecipients = await statusAudience(ctx, p);
  const tenantRow = (await ctx.queryFn('SELECT tenant_id FROM devices WHERE id = $1', [ctx.deviceId])).rows[0];
  const tenantId = String(tenantRow?.['tenant_id'] ?? '');
  if (!tenantId) throw new CommandFailure('DEVICE_NOT_FOUND', 'The number no longer exists');
  const eligible: string[] = [];
  const denied: string[] = [];
  for (const jid of requestedRecipients) {
    const phone = normalizeRecipientNumber(jid.split('@')[0] ?? '');
    if (await getStoredRecipientConsent(ctx.queryFn, tenantId, phone) === 'opted_in') eligible.push(phone);
    else denied.push(phone);
  }
  if (p.audience === 'list' && denied.length > 0) {
    throw new CommandFailure('RECIPIENT_CONSENT_REQUIRED', `${denied.length} requested recipient(s) have not opted in`);
  }
  if (denied.length > 0) {
    ctx.log.warn('Status recipients excluded by consent', {
      tenantId, count: denied.length, sampleLast4: denied.slice(0, 5).map((phone) => phone.slice(-4)),
    });
  }
  if (eligible.length === 0) throw new CommandFailure('RECIPIENT_CONSENT_REQUIRED', 'No opted-in recipients are available for this status');
  const me = ownJid(ctx.sock);
  const content = p.kind === 'text'
    ? { text: p.text ?? '', ...(p.background ? { backgroundColor: p.background } : {}) }
    : p.kind === 'image'
      ? { image: { url: p.media_url ?? '' }, ...(p.caption ? { caption: p.caption } : {}) }
      : { video: { url: p.media_url ?? '' }, ...(p.caption ? { caption: p.caption } : {}) };
  await ctx.presence?.ensureOnline();
  const lockRecipients = ctx.consentLocks ?? withRecipientConsentLocks;
  const sent = await lockRecipients(tenantId, eligible, async () => {
    const revoked: string[] = [];
    for (const phone of eligible) {
      if (await getStoredRecipientConsent(ctx.queryFn, tenantId, phone) !== 'opted_in') revoked.push(phone);
    }
    if (revoked.length > 0) throw new CommandFailure('RECIPIENT_OPTED_OUT', `${revoked.length} recipient(s) opted out before the status was sent`);
    await ctx.assertMayTransmit?.(); // last check: after audience and consent checks, immediately before transport
    return ctx.sock.sendMessage('status@broadcast', content, { statusJidList: [...new Set([me, ...eligible.map((phone) => `${phone}@s.whatsapp.net`)])] });
  });
  void ctx.presence?.afterSend();
  return { message_id: sent?.key.id ?? null, recipients: eligible.length };
}

async function readProfile(ctx: CommandContext) {
  const { sock } = ctx;
  const jid = ownJid(sock);
  const deadline = ctx.deadlineMs ?? COMMAND_DEADLINE_MS;
  const [business, about, picture] = await Promise.all([
    businessProfile(sock),
    withDeadline(Promise.resolve(sock.fetchStatus(jid)), deadline).catch(() => undefined),
    withDeadline(Promise.resolve(sock.profilePictureUrl(jid, 'image')), deadline).catch(() => undefined),
  ]);
  const first = Array.isArray(about) ? about[0] : undefined;
  const aboutText = (first as { status?: { status?: string } | string } | undefined)?.status;
  return {
    jid,
    phone: jid.split('@')[0] ?? null,
    name: sock.user?.name ?? null,
    about: typeof aboutText === 'string' ? aboutText : (aboutText?.status ?? null),
    picture_url: picture ?? null,
    is_business: Boolean(business),
    business: business ?? null,
  };
}

async function updateProfile(ctx: CommandContext, p: ProfileUpdate) {
  const { sock } = ctx;
  const deadline = ctx.deadlineMs ?? COMMAND_DEADLINE_MS;
  await ctx.assertMayTransmit?.(); // last check before the first write
  if (p.name !== undefined) await withDeadline(sock.updateProfileName(p.name), deadline);
  if (p.about !== undefined) await withDeadline(sock.updateProfileStatus(p.about), deadline);
  if (p.business) {
    await requireBusiness(sock);
    const b = p.business;
    await withDeadline(sock.updateBussinesProfile({
      ...(b.description !== undefined ? { description: b.description } : {}),
      ...(b.address !== undefined ? { address: b.address } : {}),
      ...(b.email !== undefined ? { email: b.email } : {}),
      ...(b.websites ? { websites: b.websites } : {}),
      ...(b.hours ? {
        hours: {
          timezone: b.hours.timezone,
          days: b.hours.days.map((d) => (d.mode === 'specific_hours'
            ? { day: d.day, mode: 'specific_hours', openTimeInMinutes: toMinutes(d.open ?? '00:00'), closeTimeInMinutes: toMinutes(d.close ?? '00:00') }
            : { day: d.day, mode: d.mode })) as never,
        },
      } : {}),
    }), deadline);
  }
  return readProfile(ctx);
}

async function setPicture(ctx: CommandContext, p: ProfilePicturePayload) {
  const { sock } = ctx;
  const jid = ownJid(sock);
  const deadline = ctx.deadlineMs ?? COMMAND_DEADLINE_MS;
  await ctx.assertMayTransmit?.(); // last check before the write
  if (!p.image_base64 && !p.image_url) {
    await withDeadline(sock.removeProfilePicture(jid), deadline);
  } else {
    const content = p.image_base64 ? Buffer.from(p.image_base64, 'base64') : { url: p.image_url ?? '' };
    await withDeadline(sock.updateProfilePicture(jid, content as never), deadline * 2);
  }
  return readProfile(ctx);
}

export async function executeCommand(type: CommandType, payload: unknown, ctx: CommandContext): Promise<unknown> {
  switch (type) {
    case 'profile.get':
      return readProfile(ctx);
    case 'profile.update':
      return updateProfile(ctx, payload as ProfileUpdate);
    case 'profile.picture':
      return setPicture(ctx, payload as ProfilePicturePayload);
    case 'status.post':
      return postStatus(ctx, payload as StatusPayload);
    case 'whatsapp.groups.list': {
      const deadline = ctx.deadlineMs ?? COMMAND_DEADLINE_MS;
      const [groups, communities] = await Promise.all([
        withDeadline(ctx.sock.groupFetchAllParticipating(), deadline),
        withDeadline(ctx.sock.communityFetchAllParticipating(), deadline),
      ]);
      // Baileys exposes communities through a separate query from regular groups.
      // Merge by JID because some server versions include community roots in both responses.
      const all = new Map([...Object.values(groups), ...Object.values(communities)].map((group) => [group.id, group]));
      return [...all.values()].map((group) => ({
        id: group.id,
        name: group.subject || 'Grup tanpa nama',
        member_count: group.size ?? group.participants?.length ?? 0,
        description: group.desc ?? null,
        is_community: Boolean(group.isCommunity),
        is_community_announcement: Boolean(group.isCommunityAnnounce),
        parent_community_jid: group.linkedParent ?? null,
        announcement_only: Boolean(group.announce),
        created_at: group.creation ? new Date(group.creation * 1000).toISOString() : null,
      })).sort((a, b) => a.name.localeCompare(b.name, 'id'));
    }
    case 'whatsapp.channel.lookup': {
      const { lookup } = payload as { lookup: string };
      const isJid = /^[A-Za-z0-9_-]+@newsletter$/.test(lookup);
      const key = isJid ? lookup : lookup.trim();
      const channel = await withDeadline(
        ctx.sock.newsletterMetadata(isJid ? 'jid' : 'invite', key),
        ctx.deadlineMs ?? COMMAND_DEADLINE_MS,
      );
      if (!channel) throw new CommandFailure('CHANNEL_NOT_FOUND', 'Saluran tidak ditemukan dari tautan tersebut.');
      return {
        id: channel.id,
        name: channel.name,
        description: channel.description ?? null,
        subscribers: channel.subscribers ?? null,
        verification: channel.verification ?? 'UNVERIFIED',
        invite: channel.invite ?? null,
      };
    }
    default:
      throw new CommandFailure('UNKNOWN_COMMAND', `Unknown command ${String(type)}`);
  }
}
