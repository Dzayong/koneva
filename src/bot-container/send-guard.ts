import { canSend as planCanSend, effectiveStatus, type SubscriptionStatus } from '../shared/billing';

type QueryFn = (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

/**
 * The last administrative check before anything is handed to the WhatsApp transport (`sock.sendMessage`, status posts, profile
 * writes). It reads the CURRENT state of the number and its workspace, so a job that waited in a queue, in a paced delay or in a
 * typing simulation cannot outlive a suspension or a pause that happened meanwhile.
 *
 *   device_banned       the number is banned: never sends again.
 *   workspace_suspended the workspace is not `active` (suspended/deleted), or its plan cannot send (expired, suspended, cancelled;
 *                       trial, active and past_due-in-grace still can, see shared/billing.ts).
 *   device_paused       administrative pause (status 'paused').
 *
 * A number with no workspace (standalone bot) has no workspace rules. This is a read followed immediately by the send: a change
 * made in those few milliseconds, or while the transport call is already running, cannot be stopped (see docs/OUTBOUND_CONTROLS.md).
 */
export type TransmitBlock = 'device_banned' | 'workspace_suspended' | 'device_paused' | 'device_not_found';
export interface TransmitDecision { allowed: boolean; reason?: TransmitBlock; detail?: string }

export async function checkTransmission(deviceKey: string, queryFn: QueryFn, now: Date = new Date()): Promise<TransmitDecision> {
  const row = (await queryFn(
    `SELECT d.status AS device_status, d.tenant_id, t.status AS tenant_status, s.status AS plan_status, s.period_end
     FROM devices d
     LEFT JOIN tenants t ON t.id = d.tenant_id
     LEFT JOIN subscriptions s ON s.tenant_id = d.tenant_id
     WHERE d.device_key = $1 LIMIT 1`, [deviceKey])).rows[0];
  if (!row) return { allowed: false, reason: 'device_not_found' };
  if (row['device_status'] === 'banned') return { allowed: false, reason: 'device_banned' };
  if (row['tenant_id']) {
    if (row['tenant_status'] !== 'active') return { allowed: false, reason: 'workspace_suspended', detail: `workspace_${String(row['tenant_status'] ?? 'missing')}` };
    if (row['plan_status']) {
      const status = effectiveStatus({ status: row['plan_status'] as SubscriptionStatus, period_end: (row['period_end'] as Date | null) ?? null }, now);
      if (!planCanSend(status)) return { allowed: false, reason: 'workspace_suspended', detail: `plan_${status}` };
    }
  }
  if (row['device_status'] === 'paused') return { allowed: false, reason: 'device_paused' };
  return { allowed: true };
}

/**
 * Baileys rejects `sendMessage` with a Boom error. "Connection Closed" (428) is raised before anything is written to the socket, so
 * the message definitely did not leave and a retry cannot duplicate it. Every other failure (timeouts above all) may have happened
 * after WhatsApp accepted the message, so the outcome is UNCERTAIN and must never be retried automatically.
 */
export function isDefinitelyNotSent(error: unknown): boolean {
  const e = error as { output?: { statusCode?: number }; message?: string } | undefined;
  return e?.output?.statusCode === 428 || /connection closed|not connected|socket is not connected/i.test(e?.message ?? '');
}
