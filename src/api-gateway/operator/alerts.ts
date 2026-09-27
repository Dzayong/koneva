import type { Pool } from 'pg';
import { otpLimits, SENDER_WARN_RATIO } from '../services/otp-limits';

/**
 * Read model for the OTP sender-budget alert in the Operator Panel. It only exposes counts, times and the cap: no email address,
 * IP, OTP code, limiter key or person. The alert rows themselves come from otp_threshold_events, which the limiter writes at most once per
 * kind per 24 h (that is the deduplication: repeated sends after the threshold do not create more rows).
 *
 * `usage_at_event` / `cap_at_event` are a SNAPSHOT of the moment the event happened, not today's usage. `current` is measured now
 * (rolling 24 h) against the cap configured now, which may differ from the cap at the time of the event.
 */
export const ALERT_HISTORY_DAYS = 30;
export const ALERT_HISTORY_LIMIT = 50;
export const ALERT_WINDOW_HOURS = 24;

const KINDS = {
  sender_70_percent: { threshold_percent: Math.round(SENDER_WARN_RATIO * 100), severity: 'warning' as const },
  sender_cap_reached: { threshold_percent: 100, severity: 'critical' as const },
};

export interface OtpAlertEvent {
  id: string; at: string; kind: keyof typeof KINDS;
  scope: 'sender_daily'; window_hours: number; threshold_percent: number; severity: 'warning' | 'critical';
  usage_at_event: number; cap_at_event: number; percent_at_event: number;
  /** true while the event is still inside the 24 h deduplication window (a new event of this kind cannot appear before it ends). */
  active: boolean; snapshot: true;
}
export interface OtpAlerts {
  events: OtpAlertEvent[];
  has_active: boolean;
  current: { scope: 'sender_daily'; window_hours: number; usage: number; cap: number; percent: number; measured_at: string };
  history_days: number;
}

export async function otpAlerts(db: Pool): Promise<OtpAlerts> {
  const rows = (await db.query<{ id: string; at: Date; kind: keyof typeof KINDS; window_count: number; cap: number; active: boolean }>(
    `SELECT id, at, kind, window_count, cap, (at > now() - make_interval(hours => $3)) AS active
     FROM otp_threshold_events WHERE at > now() - make_interval(days => $1) ORDER BY at DESC, id DESC LIMIT $2`,
    [ALERT_HISTORY_DAYS, ALERT_HISTORY_LIMIT, ALERT_WINDOW_HOURS])).rows;
  const usage = (await db.query<{ n: number; now: Date }>(
    `SELECT count(*)::int AS n, now() AS now FROM otp_rate_events WHERE dim = 'sender' AND at > now() - make_interval(hours => $1)`, [ALERT_WINDOW_HOURS])).rows[0]!;
  const cap = otpLimits().senderPerDay;
  const events: OtpAlertEvent[] = rows.filter((r) => r.kind in KINDS).map((r) => ({
    id: r.id, at: r.at.toISOString(), kind: r.kind, scope: 'sender_daily', window_hours: ALERT_WINDOW_HOURS,
    threshold_percent: KINDS[r.kind].threshold_percent, severity: KINDS[r.kind].severity,
    usage_at_event: r.window_count, cap_at_event: r.cap, percent_at_event: Math.round((r.window_count * 100) / Math.max(1, r.cap)),
    active: r.active, snapshot: true,
  }));
  return {
    events, has_active: events.some((e) => e.active),
    current: { scope: 'sender_daily', window_hours: ALERT_WINDOW_HOURS, usage: usage.n, cap, percent: Math.round((usage.n * 100) / cap), measured_at: usage.now.toISOString() },
    history_days: ALERT_HISTORY_DAYS,
  };
}
