import { createHash } from 'node:crypto';
import { transaction } from '../../shared/database/connection';

/**
 * Server-trusted classification for the OTP/transactional quota exemption (T1.1). This is NOT the client-chosen
 * `priority` field (any customer could set priority=urgent on ordinary marketing sends) and NOT a free-form
 * boolean the client can flip. A send is only exempt when ALL of these hold:
 *
 *   1. The request includes `otp_code`, a short numeric code.
 *   2. `message` actually CONTAINS that exact code as a substring -- the code can't be sent detached from real
 *      content just to claim exemption -- and the message is short (<=200 chars) with no media attached, matching
 *      the shape of a real one-time code, not a repurposed marketing/broadcast message.
 *   3. The (tenant, recipient) pair has not already claimed the exemption too many times recently (below):
 *      a rolling per-recipient limit so the exemption itself cannot become a way to send unlimited quota-free
 *      volume -- a real OTP flow sends one code per login/verification attempt to one number, rarely repeated.
 *
 * When any check fails, the send is never rejected because of it -- it just is not exempt, so it counts against
 * quota like any other message (see message.service.ts). This module never blocks a send, only classifies it.
 */
const OTP_CODE_PATTERN = /^[0-9]{4,10}$/;
const MAX_TRANSACTIONAL_MESSAGE_LENGTH = 200;

export interface ExemptionCandidate {
  tenantId: string;
  to: string;
  message: string;
  mediaUrl?: string | null | undefined;
  otpCode?: string | undefined;
}

export function looksLikeTransactional(candidate: Pick<ExemptionCandidate, 'message' | 'mediaUrl' | 'otpCode'>): boolean {
  const code = candidate.otpCode;
  if (!code || !OTP_CODE_PATTERN.test(code)) return false;
  if (candidate.mediaUrl) return false;
  if (candidate.message.length === 0 || candidate.message.length > MAX_TRANSACTIONAL_MESSAGE_LENGTH) return false;
  return candidate.message.includes(code);
}

export interface TransactionalLimits { perRecipientPer10Min: number; perTenantPerHour: number }
export const DEFAULT_TRANSACTIONAL_LIMITS: TransactionalLimits = { perRecipientPer10Min: 3, perTenantPerHour: 200 };

const keyOf = (label: string, value: string): string => createHash('sha256').update(`msg-exempt:${label}:${value}`).digest('hex');
const recipientKey = (tenantId: string, to: string): string => keyOf('recipient', `${tenantId}:${to}`);
const tenantKey = (tenantId: string): string => keyOf('tenant', tenantId);

/**
 * Atomically checks the rolling exemption limits and, only if both pass, records one claim. Never throws: returns
 * false on any rate-limit hit so the caller falls back to counting the send against quota like normal, instead of
 * failing the send outright.
 */
export async function reserveTransactionalExemption(
  tenantId: string,
  to: string,
  limits: TransactionalLimits = DEFAULT_TRANSACTIONAL_LIMITS,
): Promise<boolean> {
  const recipient = recipientKey(tenantId, to);
  const tenant = tenantKey(tenantId);
  return transaction(async (client) => {
    const keys: Array<[string, string]> = ([['recipient', recipient], ['tenant', tenant]] as Array<[string, string]>)
      .sort((a, b) => `${a[0]}:${a[1]}`.localeCompare(`${b[0]}:${b[1]}`));
    for (const [dim, key] of keys) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`msg-exempt:${dim}:${key}`]);

    const { n: recipientCount } = (await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM message_exempt_events WHERE dim = 'recipient' AND key = $1 AND at > now() - interval '10 minutes'`,
      [recipient],
    )).rows[0]!;
    if (recipientCount >= limits.perRecipientPer10Min) return false;

    const { n: tenantCount } = (await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM message_exempt_events WHERE dim = 'tenant' AND key = $1 AND at > now() - interval '1 hour'`,
      [tenant],
    )).rows[0]!;
    if (tenantCount >= limits.perTenantPerHour) return false;

    await client.query(
      `INSERT INTO message_exempt_events (dim, key) VALUES ('recipient', $1), ('tenant', $2)`,
      [recipient, tenant],
    );
    await client.query(`DELETE FROM message_exempt_events WHERE id IN (SELECT id FROM message_exempt_events WHERE at < now() - interval '2 days' LIMIT 500)`);
    return true;
  });
}
