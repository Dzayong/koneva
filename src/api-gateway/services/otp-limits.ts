import { createHmac } from 'node:crypto';
import type { PoolClient } from 'pg';
import config from '../../shared/config';
import { transaction } from '../../shared/database/connection';
import logger from '../../shared/utils/logger';
import { ServiceError } from './service-error';

/**
 * Limits on OTP sends (email and signup WhatsApp), shared by every API process through PostgreSQL.
 *
 *   recipient  3 per hour and 6 per 24 h, across all invitations/workspaces/purposes (Gmail aliases share one bucket)
 *   invitation 3 per hour (plus the 60 s pause kept in team.service)
 *   workspace  10 per 24 h
 *   sender     200 per 24 h for the whole system across channels (OTP_SENDER_DAILY_CAP), 70 % is recorded
 *   ip         20 OTP requests per 15 min
 *
 * Rolling windows: a slot frees exactly when its event is older than the window. Each check-and-record runs in one transaction
 * holding advisory locks on every key involved (taken in sorted order, so no deadlocks), so concurrent requests cannot both
 * take the last slot. An attempt that reached the provider counts, including one whose delivery turned out uncertain.
 */
export interface OtpLimits { recipientPerHour: number; recipientPerDay: number; invitationPerHour: number; workspacePerDay: number; senderPerDay: number; ipPer15Min: number }
export const DEFAULT_OTP_LIMITS: OtpLimits = { recipientPerHour: 3, recipientPerDay: 6, invitationPerHour: 3, workspacePerDay: 10, senderPerDay: 200, ipPer15Min: 20 };
export const SENDER_WARN_RATIO = 0.7;

export function otpLimits(env: NodeJS.ProcessEnv = process.env): OtpLimits {
  const raw = env['OTP_SENDER_DAILY_CAP'];
  if (raw === undefined || raw === '') return DEFAULT_OTP_LIMITS;
  const cap = Number(raw);
  if (!Number.isInteger(cap) || cap < 1 || cap > 100_000) throw new Error('OTP_SENDER_DAILY_CAP must be an integer from 1 to 100000');
  return { ...DEFAULT_OTP_LIMITS, senderPerDay: cap };
}

// ---- Keys: HMAC only, never the raw address, address alias, IP or id ---------------------------------------------------
const limiterSecret = (): Buffer => createHmac('sha256', config.jwt.secret).update('otp-limiter-key-v1').digest();
const keyOf = (label: string, value: string): string => createHmac('sha256', limiterSecret()).update(`${label}:${value}`).digest('hex');

/**
 * Gmail treats dots and everything after "+" in the local part as the same inbox, and googlemail.com as gmail.com. For the limiter
 * ONLY, those variants are folded into one bucket. The address used for the invitation and for sending is never changed.
 */
export function limiterAddress(email: string): string {
  const [local = '', domain = ''] = email.trim().toLowerCase().split('@');
  if (domain === 'gmail.com' || domain === 'googlemail.com') return `${local.split('+')[0]!.replace(/\./g, '')}@gmail.com`;
  return `${local}@${domain}`;
}
export const recipientKey = (email: string): string => keyOf('recipient', limiterAddress(email));
export const whatsappRecipientKey = (phoneDigits: string): string => keyOf('recipient', `whatsapp:${phoneDigits}`);
export const invitationKey = (invitationId: string): string => keyOf('invitation', invitationId);
export const workspaceKey = (tenantId: string): string => keyOf('workspace', tenantId);
export const ipKey = (ip: string | undefined): string => keyOf('ip', ip ?? 'unknown');
/** The sender budget is one shared counter; its key is a fixed placeholder, not derived from anything. */
const SENDER_KEY = '0'.repeat(64);

type Dim = 'recipient' | 'invitation' | 'workspace' | 'sender' | 'ip';
interface Rule { dim: Dim; key: string; windowSeconds: number; limit: number }
export type Refusal = { code: 'OTP_RATE_LIMITED' | 'OTP_CAPACITY_REACHED'; status: 429 | 503; retryAfter: number };

const lock = (client: PoolClient, dim: Dim, key: string) => client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`otp:${dim}:${key}`]);

/** Seconds until the rule has a free slot again (age of the event whose expiry brings the count below the limit). */
async function retryAfter(client: PoolClient, rule: Rule): Promise<number> {
  const row = (await client.query<{ wait: number }>(
    `SELECT GREATEST(1, ceil(extract(epoch FROM (at + make_interval(secs => $3)) - now())))::int AS wait
     FROM otp_rate_events WHERE dim = $1 AND key = $2 AND at > now() - make_interval(secs => $3)
     ORDER BY at DESC OFFSET $4 LIMIT 1`, [rule.dim, rule.key, rule.windowSeconds, rule.limit - 1])).rows[0];
  return row?.wait ?? rule.windowSeconds;
}

async function violated(client: PoolClient, rules: Rule[]): Promise<{ rule: Rule; wait: number } | undefined> {
  for (const rule of rules) {
    const { n } = (await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM otp_rate_events WHERE dim = $1 AND key = $2 AND at > now() - make_interval(secs => $3)`,
      [rule.dim, rule.key, rule.windowSeconds])).rows[0]!;
    if (n >= rule.limit) return { rule, wait: await retryAfter(client, rule) };
  }
  return undefined;
}

async function recordThreshold(client: PoolClient, kind: 'sender_70_percent' | 'sender_cap_reached', count: number, cap: number): Promise<void> {
  // Once per 24 h per kind. Counts only: no email, address, IP or person.
  const inserted = await client.query(
    `INSERT INTO otp_threshold_events (kind, window_count, cap)
     SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM otp_threshold_events WHERE kind = $1 AND at > now() - interval '24 hours')`, [kind, count, cap]);
  if (inserted.rowCount) logger.warn('OTP sender budget threshold', { kind, count, cap });
}

/** Cheap first line of defence, checked before any invitation lookup: OTP requests per source address. */
export async function reserveIpRequest(ip: string | undefined, limits: OtpLimits = otpLimits()): Promise<void> {
  const key = ipKey(ip);
  const refusal = await transaction(async (client) => {
    await lock(client, 'ip', key);
    const rule: Rule = { dim: 'ip', key, windowSeconds: 15 * 60, limit: limits.ipPer15Min };
    const hit = await violated(client, [rule]);
    if (hit) return { code: 'OTP_RATE_LIMITED' as const, status: 429 as const, retryAfter: hit.wait };
    await client.query("INSERT INTO otp_rate_events (dim, key) VALUES ('ip', $1)", [key]);
    await client.query("DELETE FROM otp_rate_events WHERE id IN (SELECT id FROM otp_rate_events WHERE at < now() - interval '2 days' LIMIT 500)");
    return undefined;
  });
  if (refusal) throw refuse(refusal);
}

export interface SendContext { email: string; invitationId?: string; tenantId?: string }

/**
 * Atomically checks every limit that applies to one OTP email and, only if all pass, records it. Throws 429 (per recipient,
 * invitation, workspace) or 503 (sender budget) with Retry-After. Call it BEFORE sending, after the mail transport is known to be
 * configured, so a fail-safe refusal records nothing.
 */
export async function reserveOtpSend(context: SendContext, limits: OtpLimits = otpLimits()): Promise<void> {
  const recipient = recipientKey(context.email);
  const invitation = context.invitationId ? invitationKey(context.invitationId) : undefined;
  const workspace = context.tenantId ? workspaceKey(context.tenantId) : undefined;
  const refusal = await transaction(async (client): Promise<Refusal | undefined> => {
    const locks: Array<[Dim, string]> = [['recipient', recipient], ['sender', SENDER_KEY]];
    if (invitation) locks.push(['invitation', invitation]);
    if (workspace) locks.push(['workspace', workspace]);
    locks.sort((a, b) => `${a[0]}:${a[1]}`.localeCompare(`${b[0]}:${b[1]}`));
    for (const [dim, key] of locks) await lock(client, dim, key);

    const rules: Rule[] = [
      { dim: 'recipient', key: recipient, windowSeconds: 3600, limit: limits.recipientPerHour },
      { dim: 'recipient', key: recipient, windowSeconds: 86_400, limit: limits.recipientPerDay },
    ];
    if (invitation) rules.push({ dim: 'invitation', key: invitation, windowSeconds: 3600, limit: limits.invitationPerHour });
    if (workspace) rules.push({ dim: 'workspace', key: workspace, windowSeconds: 86_400, limit: limits.workspacePerDay });
    const hit = await violated(client, rules);
    if (hit) return { code: 'OTP_RATE_LIMITED', status: 429, retryAfter: hit.wait };

    const senderRule: Rule = { dim: 'sender', key: SENDER_KEY, windowSeconds: 86_400, limit: limits.senderPerDay };
    const senderHit = await violated(client, [senderRule]);
    if (senderHit) {
      await recordThreshold(client, 'sender_cap_reached', limits.senderPerDay, limits.senderPerDay);
      return { code: 'OTP_CAPACITY_REACHED', status: 503, retryAfter: senderHit.wait };
    }

    await client.query("INSERT INTO otp_rate_events (dim, key) VALUES ('recipient', $1), ('sender', $2)", [recipient, SENDER_KEY]);
    if (invitation) await client.query("INSERT INTO otp_rate_events (dim, key) VALUES ('invitation', $1)", [invitation]);
    if (workspace) await client.query("INSERT INTO otp_rate_events (dim, key) VALUES ('workspace', $1)", [workspace]);
    const { n } = (await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM otp_rate_events WHERE dim = 'sender' AND key = $1 AND at > now() - interval '24 hours'", [SENDER_KEY])).rows[0]!;
    if (n >= Math.ceil(limits.senderPerDay * SENDER_WARN_RATIO)) await recordThreshold(client, 'sender_70_percent', n, limits.senderPerDay);
    return undefined;
  });
  if (refusal) throw refuse(refusal);
}

/** Same recipient and shared sender budgets as email OTP, but keyed by a normalized phone number. */
export async function reserveWhatsappOtpSend(phoneDigits: string, limits: OtpLimits = otpLimits()): Promise<void> {
  const recipient = whatsappRecipientKey(phoneDigits);
  const refusal = await transaction(async (client): Promise<Refusal | undefined> => {
    for (const [dim, key] of [['recipient', recipient], ['sender', SENDER_KEY]].sort((a, b) => `${a[0]}:${a[1]}`.localeCompare(`${b[0]}:${b[1]}`)) as Array<[Dim, string]>) {
      await lock(client, dim, key);
    }
    const rules: Rule[] = [
      { dim: 'recipient', key: recipient, windowSeconds: 3600, limit: limits.recipientPerHour },
      { dim: 'recipient', key: recipient, windowSeconds: 86_400, limit: limits.recipientPerDay },
    ];
    const hit = await violated(client, rules);
    if (hit) return { code: 'OTP_RATE_LIMITED', status: 429, retryAfter: hit.wait };
    const senderRule: Rule = { dim: 'sender', key: SENDER_KEY, windowSeconds: 86_400, limit: limits.senderPerDay };
    const senderHit = await violated(client, [senderRule]);
    if (senderHit) {
      await recordThreshold(client, 'sender_cap_reached', limits.senderPerDay, limits.senderPerDay);
      return { code: 'OTP_CAPACITY_REACHED', status: 503, retryAfter: senderHit.wait };
    }
    await client.query("INSERT INTO otp_rate_events (dim, key) VALUES ('recipient', $1), ('sender', $2)", [recipient, SENDER_KEY]);
    const { n } = (await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM otp_rate_events WHERE dim = 'sender' AND key = $1 AND at > now() - interval '24 hours'", [SENDER_KEY])).rows[0]!;
    if (n >= Math.ceil(limits.senderPerDay * SENDER_WARN_RATIO)) await recordThreshold(client, 'sender_70_percent', n, limits.senderPerDay);
    return undefined;
  });
  if (refusal) throw refuse(refusal);
}

function refuse(refusal: Refusal): ServiceError {
  return refusal.status === 429
    ? new ServiceError(429, refusal.code, 'Terlalu banyak permintaan kode. Coba lagi nanti.', refusal.retryAfter)
    : new ServiceError(503, refusal.code, 'Pengiriman kode sedang dibatasi. Coba lagi nanti.', refusal.retryAfter);
}
