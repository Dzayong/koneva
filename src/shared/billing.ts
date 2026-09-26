// Pure billing rules: what a subscription allows right now, and when quotas reset.

export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'suspended' | 'expired' | 'cancelled';
export type BillingCycle = 'monthly' | 'yearly';

export const GRACE_DAYS = 7;
const DAY_MS = 86_400_000;

export interface SubscriptionState {
  status: SubscriptionStatus;
  period_end: Date | string | null;
}

/**
 * Status as of `now`, derived from the dates so the answer is right even if the hourly sweeper has not run.
 * After a paid period ends there is a short grace period in which sending still works.
 */
export function effectiveStatus(sub: SubscriptionState, now: Date = new Date()): SubscriptionStatus {
  const end = sub.period_end ? new Date(sub.period_end).getTime() : null;
  switch (sub.status) {
    case 'trial':
      return end !== null && now.getTime() > end ? 'expired' : 'trial';
    case 'active':
    case 'past_due':
      if (end === null || now.getTime() <= end) return 'active';
      return now.getTime() <= end + GRACE_DAYS * DAY_MS ? 'past_due' : 'suspended';
    default:
      return sub.status;
  }
}

/** Only these may send; an expired, suspended or cancelled workspace keeps its numbers and data but not its sending. */
export const CAN_SEND: ReadonlySet<SubscriptionStatus> = new Set(['trial', 'active', 'past_due']);

export function canSend(status: SubscriptionStatus): boolean {
  return CAN_SEND.has(status);
}

/** `date` plus whole months; a 31st rolls back to the last day of a shorter month instead of spilling over. */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/** The monthly quota window containing `now`, anchored to the subscription's start day. */
export function usageWindow(anchor: Date, now: Date = new Date()): { start: Date; end: Date } {
  let n = (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (now.getUTCMonth() - anchor.getUTCMonth());
  if (n < 0) n = 0;
  if (addMonths(anchor, n).getTime() > now.getTime()) n -= 1;
  // Each boundary is computed from the anchor, so an anchor on the 31st stays on the month's last day.
  return { start: addMonths(anchor, n), end: addMonths(anchor, n + 1) };
}

/** A renewal extends from the later of now and the current end, so paying early loses nothing. */
export function nextPeriod(currentEnd: Date | string | null, cycle: BillingCycle, now: Date = new Date()): { start: Date; end: Date } {
  const currentEndMs = currentEnd ? new Date(currentEnd).getTime() : 0;
  const start = new Date(Math.max(now.getTime(), currentEndMs));
  return { start, end: addMonths(start, cycle === 'yearly' ? 12 : 1) };
}

export function priceFor(plan: { price_month_idr: number; price_year_idr: number }, cycle: BillingCycle): number {
  return cycle === 'yearly' ? plan.price_year_idr : plan.price_month_idr;
}

const STUDENT_DOMAINS = [/\.ac\.id$/i, /\.sch\.id$/i, /\.edu$/i, /\.edu\.[a-z]{2}$/i, /\.ac\.[a-z]{2}$/i];

/** A quick format check only; a person still approves student status by hand. */
export function looksLikeStudentEmail(email: string): boolean {
  const domain = email.split('@')[1] ?? '';
  return STUDENT_DOMAINS.some((pattern) => pattern.test(domain));
}
