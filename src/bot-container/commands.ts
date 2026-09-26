import { jidNormalizedUser, type WASocket } from '@whiskeysockets/baileys';
import type { Logger } from 'winston';
import { PRICE_SCALE, type CommandType, type StatusPayload } from '../shared/commands';
import { getOrCreatePersona, isWithinPersonaWindow, msUntilWindowOpens } from '../shared/persona';
import type { PresenceRoutine } from './presence';

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
  /** Test hook: shorter give-up time for catalog calls. */
  deadlineMs?: number;
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
 * Baileys logs "timed out waiting for message" and then resolves with an EMPTY result, so a catalog that
 * WhatsApp never answered looks like an empty catalog. Seen live on a real Business number (60 s, empty).
 * Give up earlier and say so instead of showing a false "no products".
 */
export const CATALOG_DEADLINE_MS = 20_000;
async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new CommandFailure('CATALOG_TIMEOUT', 'WhatsApp did not answer the catalog request')), ms); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

export const toWirePrice = (price: number): number => Math.round(price * PRICE_SCALE);
export const fromWirePrice = (wire: number): number => wire / PRICE_SCALE;

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
  if (!profile) throw new CommandFailure('NOT_BUSINESS', 'This number is a regular WhatsApp account. Catalog and business profile need WhatsApp Business.');
  return profile;
}

function mapProduct(p: { price?: number } & Record<string, unknown>) {
  return { ...p, price: typeof p.price === 'number' ? fromWirePrice(p.price) : p.price };
}

const toMinutes = (hhmm: string): string => {
  const [h = '0', m = '0'] = hhmm.split(':');
  return String(Number(h) * 60 + Number(m));
};

interface ProductInput {
  id?: string; name: string; description?: string; price: number; currency?: string; url?: string;
  retailer_id?: string; is_hidden?: boolean; image_urls: string[]; origin_country?: string;
}
const productBody = (p: ProductInput) => ({
  name: p.name, description: p.description ?? '', price: toWirePrice(p.price), currency: p.currency ?? 'IDR',
  ...(p.url ? { url: p.url } : {}), ...(p.retailer_id ? { retailerId: p.retailer_id } : {}),
  isHidden: p.is_hidden ?? false, images: p.image_urls.map((url) => ({ url })),
});

/** JIDs that may see a status: people this number has actually exchanged messages with, or an explicit list. */
export async function statusAudience(ctx: CommandContext, p: StatusPayload): Promise<string[]> {
  const numbers = new Set<string>();
  if (p.audience === 'list') {
    for (const n of p.numbers ?? []) numbers.add(n.replace(/^\+/, ''));
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
  if (numbers.size === 0) throw new CommandFailure('NO_AUDIENCE', 'No contacts to show this status to yet. Exchange messages first, or provide a list of numbers.');
  return [...numbers].map((n) => `${n}@s.whatsapp.net`);
}

async function postStatus(ctx: CommandContext, p: StatusPayload) {
  const persona = await getOrCreatePersona(ctx.deviceId, ctx.queryFn);
  const now = (ctx.now ?? (() => new Date()))();
  if (!isWithinPersonaWindow(persona, now)) {
    // Wait for the number's day to start, plus a random 0-20 minutes so it does not post at the exact opening minute.
    throw new Reschedule(msUntilWindowOpens(persona, now) + Math.round((ctx.random ?? Math.random)() * 20 * 60_000), 'outside_active_hours');
  }
  const recipients = await statusAudience(ctx, p);
  const me = ownJid(ctx.sock);
  const content = p.kind === 'text'
    ? { text: p.text ?? '', ...(p.background ? { backgroundColor: p.background } : {}) }
    : p.kind === 'image'
      ? { image: { url: p.media_url ?? '' }, ...(p.caption ? { caption: p.caption } : {}) }
      : { video: { url: p.media_url ?? '' }, ...(p.caption ? { caption: p.caption } : {}) };
  await ctx.presence?.ensureOnline();
  const sent = await ctx.sock.sendMessage('status@broadcast', content, { statusJidList: [...new Set([me, ...recipients])] });
  void ctx.presence?.afterSend();
  return { message_id: sent?.key.id ?? null, recipients: recipients.length };
}

export async function executeCommand(type: CommandType, payload: unknown, ctx: CommandContext): Promise<unknown> {
  const { sock } = ctx;
  switch (type) {
    case 'account.info': {
      const profile = await businessProfile(sock);
      return { jid: ownJid(sock), name: sock.user?.name ?? null, is_business: Boolean(profile) };
    }
    case 'business.get': {
      const profile = await businessProfile(sock);
      return profile ? { is_business: true, profile } : { is_business: false, profile: null };
    }
    case 'business.update': {
      await requireBusiness(sock);
      const p = payload as { description?: string; address?: string; email?: string; websites?: string[]; hours?: { timezone: string; days: Array<Record<string, string>> } };
      await sock.updateBussinesProfile({
        ...(p.description !== undefined ? { description: p.description } : {}),
        ...(p.address !== undefined ? { address: p.address } : {}),
        ...(p.email !== undefined ? { email: p.email } : {}),
        ...(p.websites ? { websites: p.websites } : {}),
        ...(p.hours ? {
          hours: {
            timezone: p.hours.timezone,
            days: p.hours.days.map((d) => (d['mode'] === 'specific_hours'
              ? { day: d['day'], mode: 'specific_hours', openTimeInMinutes: toMinutes(d['open'] ?? '00:00'), closeTimeInMinutes: toMinutes(d['close'] ?? '00:00') }
              : { day: d['day'], mode: d['mode'] })) as never,
          },
        } : {}),
      });
      return { is_business: true, profile: await businessProfile(sock) };
    }
    case 'catalog.list': {
      await requireBusiness(sock);
      const p = payload as { limit?: number; cursor?: string };
      const catalog = await withDeadline(sock.getCatalog({ limit: p.limit ?? 20, ...(p.cursor ? { cursor: p.cursor } : {}) }), (ctx.deadlineMs ?? CATALOG_DEADLINE_MS));
      return { products: catalog.products.map((x) => mapProduct(x as never)), next_cursor: catalog.nextPageCursor ?? null };
    }
    case 'collections.list': {
      await requireBusiness(sock);
      const collections = await withDeadline(sock.getCollections(), (ctx.deadlineMs ?? CATALOG_DEADLINE_MS));
      return { collections: collections.collections.map((c) => ({ ...c, products: c.products.map((x) => mapProduct(x as never)) })) };
    }
    case 'product.create': {
      await requireBusiness(sock);
      const p = payload as ProductInput;
      const created = await withDeadline(sock.productCreate({ ...productBody(p), originCountryCode: p.origin_country } as never), (ctx.deadlineMs ?? CATALOG_DEADLINE_MS));
      return mapProduct(created as never);
    }
    case 'product.update': {
      await requireBusiness(sock);
      const p = payload as ProductInput;
      const updated = await withDeadline(sock.productUpdate(String(p.id), productBody(p) as never), (ctx.deadlineMs ?? CATALOG_DEADLINE_MS));
      return mapProduct(updated as never);
    }
    case 'product.delete': {
      await requireBusiness(sock);
      const p = payload as { id: string };
      return await withDeadline(sock.productDelete([p.id]), (ctx.deadlineMs ?? CATALOG_DEADLINE_MS));
    }
    case 'status.post':
      return postStatus(ctx, payload as StatusPayload);
    default:
      throw new CommandFailure('UNKNOWN_COMMAND', `Unknown command ${String(type)}`);
  }
}
