import logger from '../shared/utils/logger';
import { getDeviceByKey, getDeliveryMetrics, calculateHealthScore, type QueryFn } from './health-score';

export type { QueryFn };
import { evaluateContent, type RecipientMessage } from './content-filter';
import { hasRecipientOptedOut } from '../shared/readiness';
import {
  dailyFactor, delayBetweenMessagesMs, evaluateFatigue, getBurstState, getOrCreatePersona,
  isWithinPersonaWindow, msUntilNextDayWindow, msUntilWindowOpens,
} from '../shared/persona';

const MIN_SAMPLES_FOR_PAUSE = 10;
const FALLBACK_CAP_WHEN_UNPROVEN = 5;

export interface HealthTier {
  minScore: number;
  maxMessagesPerDay: number | null;
}

const HEALTH_TIERS: HealthTier[] = [
  { minScore: 90, maxMessagesPerDay: 100 },
  { minScore: 70, maxMessagesPerDay: 50 },
  { minScore: 50, maxMessagesPerDay: 20 },
  { minScore: 30, maxMessagesPerDay: 5 },
  { minScore: 0, maxMessagesPerDay: null },
];

export function getDailyCapByHealthScore(score: number): number | null {
  const tier = HEALTH_TIERS.find((t) => score >= t.minScore) ?? HEALTH_TIERS[HEALTH_TIERS.length - 1]!;
  return tier.maxMessagesPerDay;
}

const MIN_TYPING_MS = 1_500;
const MAX_TYPING_MS = 12_000;
const DEFAULT_TYPING_MS_PER_CHAR = 55;
const PER_MINUTE_LIMIT = 2;
const URGENT_PER_MINUTE_LIMIT = 20;
const PAUSE_DURATION_MS = 24 * 60 * 60_000;
const DEFAULT_TIMEZONE = 'Asia/Jakarta';
const JAKARTA_UTC_OFFSET_MS = 7 * 60 * 60_000;
const SEND_WINDOW_START_HOUR = 8;
const SEND_WINDOW_END_HOUR = 22;

function randomBetween(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min));
}

export interface TypingSimulation {
  shouldSimulate: boolean;
  durationMs: number;
}

// A person always shows "typing…" before sending, and takes longer for longer
// text; a fixed or occasional indicator is itself a bot signature.
export function getTypingSimulation(contentLength = 0, msPerChar = DEFAULT_TYPING_MS_PER_CHAR): TypingSimulation {
  const base = contentLength > 0 ? contentLength * msPerChar : randomBetween(2_000, 5_000);
  const jittered = base + randomBetween(-400, 1_200);
  return { shouldSimulate: true, durationMs: Math.min(MAX_TYPING_MS, Math.max(MIN_TYPING_MS, jittered)) };
}

function getHourAndWeekday(date: Date, timeZone: string): { hour: number; weekday: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hour12: false,
    weekday: 'short',
  }).formatToParts(date);

  const hourPart = parts.find((p) => p.type === 'hour')?.value ?? '0';
  const weekdayPart = parts.find((p) => p.type === 'weekday')?.value ?? '';
  return { hour: Number(hourPart) % 24, weekday: weekdayPart };
}

export interface TimeWindowOptions {
  timeZone?: string | undefined;
  blockFridayLunch?: boolean | undefined;
}

export function isWithinSendingWindow(date: Date = new Date(), options: TimeWindowOptions = {}): boolean {
  const timeZone = options.timeZone ?? DEFAULT_TIMEZONE;
  const { hour, weekday } = getHourAndWeekday(date, timeZone);

  if (hour < SEND_WINDOW_START_HOUR || hour >= SEND_WINDOW_END_HOUR) {
    return false;
  }

  if (options.blockFridayLunch && weekday === 'Fri' && hour >= 12 && hour < 14) {
    return false;
  }

  return true;
}

function startOfDayJakartaUtc(date: Date): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DEFAULT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = Number(parts.find((p) => p.type === 'year')?.value ?? '1970');
  const month = Number(parts.find((p) => p.type === 'month')?.value ?? '1');
  const day = Number(parts.find((p) => p.type === 'day')?.value ?? '1');

  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - JAKARTA_UTC_OFFSET_MS);
}

export async function countMessagesSince(
  deviceId: string,
  since: Date,
  queryFn: QueryFn,
): Promise<number> {
  const { rows } = await queryFn(
    // Sending and delivery_uncertain rows are reservations: WhatsApp may have
    // accepted the message even if the final database update failed.
    `SELECT COUNT(*) AS count FROM messages
     WHERE device_id = $1 AND direction = 'outbound'
       AND (status IN ('sending', 'sent', 'delivered', 'read') OR (status = 'failed' AND error_message = 'delivery_uncertain'))
       AND COALESCE(sent_at, send_started_at, created_at) >= $2`,
    [deviceId, since],
  );
  const row = rows[0] as { count: string } | undefined;
  return Number(row?.count ?? 0);
}

async function pauseDevice(deviceId: string, now: Date, queryFn: QueryFn): Promise<void> {
  const pausedUntil = new Date(now.getTime() + PAUSE_DURATION_MS);
  await queryFn(
    `UPDATE devices SET paused_until = $1, status = 'paused', updated_at = now() WHERE id = $2`,
    [pausedUntil, deviceId],
  );
}

export type AntiBanDenialReason =
  | 'device_not_found'
  | 'device_paused'
  | 'device_banned'
  | 'health_score_too_low'
  | 'daily_cap_reached'
  | 'resting'
  | 'recipient_opted_out'
  | 'rate_limit_per_minute'
  | 'outside_sending_window'
  | 'content_rejected';

export interface AntiBanDecision {
  allowed: boolean;
  reason?: AntiBanDenialReason | undefined;
  contentReasons?: string[] | undefined;
  delayMs: number;
  typing: TypingSimulation;
  healthScore: number;
  dailyCap: number;
  sentToday: number;
  /** When a denial is temporary: how long the queue should wait before trying again. */
  retryAfterMs?: number | undefined;
}

export type MessagePriority = 'normal' | 'urgent';

export interface CanSendMessageOptions {
  /** 'urgent' (OTP, transactional) skips pacing, active hours, rests and content rules; caps and pauses still apply. */
  priority?: MessagePriority | undefined;
  isProactive?: boolean | undefined;
  hasMedia?: boolean | undefined;
  content?: string | undefined;
  recipient?: string | undefined;
  recipientName?: string | undefined;
  requirePersonalization?: boolean | undefined;
  recentMessages?: string[] | undefined;
  recentByRecipient?: RecipientMessage[] | undefined;
  timeZone?: string | undefined;
  blockFridayLunch?: boolean | undefined;
  queryFn: QueryFn;
  now?: Date | undefined;
}

function denial(
  reason: AntiBanDenialReason,
  extra: Partial<Pick<AntiBanDecision, 'healthScore' | 'dailyCap' | 'sentToday' | 'retryAfterMs'>> = {},
): AntiBanDecision {
  return {
    allowed: false,
    reason,
    delayMs: 0,
    typing: { shouldSimulate: false, durationMs: 0 },
    healthScore: extra.healthScore ?? 0,
    dailyCap: extra.dailyCap ?? 0,
    sentToday: extra.sentToday ?? 0,
    ...(extra.retryAfterMs !== undefined ? { retryAfterMs: extra.retryAfterMs } : {}),
  };
}

export async function canSendMessage(
  deviceKey: string,
  options: CanSendMessageOptions,
): Promise<AntiBanDecision> {
  const { queryFn } = options;
  const now = options.now ?? new Date();

  const device = await getDeviceByKey(deviceKey, queryFn);
  if (!device) {
    return denial('device_not_found');
  }

  // Two independent pause mechanisms feed devices.status: an admin calling
  // POST /api/v1/devices/:key/pause (status only, no pausedUntil) and this
  // module's own health-score auto-pause (status AND pausedUntil). Both
  // must block sending, not just the one that happens to set pausedUntil.
  // A banned number will never send again: fail its messages now instead of re-queueing them forever.
  if (device.status === 'banned') {
    return denial('device_banned', { healthScore: device.healthScore });
  }
  const isAdministrativelyPaused = device.status === 'paused';
  const isAutoPaused = device.pausedUntil !== null && device.pausedUntil.getTime() > now.getTime();
  if (isAdministrativelyPaused || isAutoPaused) {
    return denial('device_paused', { healthScore: device.healthScore });
  }

  // Honoring "stop" requests is a hard rule for proactive sends, independent of score.
  const urgent = options.priority === 'urgent';
  if (!urgent && options.isProactive && options.recipient && (await hasRecipientOptedOut(device.id, options.recipient, queryFn))) {
    return denial('recipient_opted_out', { healthScore: device.healthScore });
  }

  const healthScore = await calculateHealthScore(deviceKey, queryFn);
  const metrics = await getDeliveryMetrics(device.id, queryFn);
  const rawHealthCap = getDailyCapByHealthScore(healthScore);

  // A device with too little history is limited by the ordinary health cap until
  // there is enough delivery history to assess it; device age is not a send gate.
  const healthCap =
    rawHealthCap === null && metrics.totalSent < MIN_SAMPLES_FOR_PAUSE
      ? FALLBACK_CAP_WHEN_UNPROVEN
      : rawHealthCap;

  if (healthCap === null) {
    await pauseDevice(device.id, now, queryFn);
    return denial('health_score_too_low', { healthScore });
  }


  const persona = await getOrCreatePersona(device.id, queryFn);
  const dailyCap = Math.max(1, Math.floor(healthCap * dailyFactor(persona, now)));
  const sentToday = await countMessagesSince(device.id, startOfDayJakartaUtc(now), queryFn);

  if (sentToday >= dailyCap) {
    return denial('daily_cap_reached', {
      healthScore, dailyCap, sentToday,
      retryAfterMs: msUntilNextDayWindow(persona, now) + Math.round(Math.random() * 10 * 60_000),
    });
  }

  const sentLastMinute = await countMessagesSince(device.id, new Date(now.getTime() - 60_000), queryFn);
  if (sentLastMinute >= (urgent ? URGENT_PER_MINUTE_LIMIT : PER_MINUTE_LIMIT)) {
    return denial('rate_limit_per_minute', { healthScore, dailyCap, sentToday });
  }

  const inFridayLunch = options.blockFridayLunch
    ? !isWithinSendingWindow(now, { timeZone: persona.timezone, blockFridayLunch: true })
    : false;
  if (!urgent && (!isWithinPersonaWindow(persona, now) || inFridayLunch)) {
    return denial('outside_sending_window', {
      healthScore, dailyCap, sentToday,
      retryAfterMs: msUntilWindowOpens(persona, now) + Math.round(Math.random() * 10 * 60_000),
    });
  }

  // A person gets tired: after a burst of proactive sends this number rests for a
  // while. Replies to people who wrote first are never held back by this.
  if (options.isProactive && !urgent) {
    const fatigue = evaluateFatigue(persona, await getBurstState(device.id, queryFn), now);
    if (fatigue.resting && fatigue.restEndsAt) {
      return denial('resting', {
        healthScore, dailyCap, sentToday,
        retryAfterMs: fatigue.restEndsAt.getTime() - now.getTime() + Math.round(Math.random() * 60_000),
      });
    }
  }

  if (!urgent && options.content !== undefined) {
    const evaluation = evaluateContent(options.content, {
      recipient: options.recipient ?? '',
      recipientName: options.recipientName,
      recentMessages: options.recentMessages,
      recentByRecipient: options.recentByRecipient,
      requirePersonalization: options.requirePersonalization,
    });

    if (!evaluation.allowed) {
      return {
        allowed: false,
        reason: 'content_rejected',
        contentReasons: evaluation.reasons,
        delayMs: 0,
        typing: { shouldSimulate: false, durationMs: 0 },
        healthScore,
        dailyCap,
        sentToday,
      };
    }
  }

  const typing = urgent || !persona.typingEnabled
    ? { shouldSimulate: false, durationMs: 0 }
    : getTypingSimulation(options.hasMedia ? 0 : (options.content?.length ?? 0), persona.typingMsPerChar);

  logger.info('Message send approved', {
    deviceKey,
    deviceId: device.id,
    healthScore,
    dailyCap,
    sentToday,
  });

  return {
    allowed: true,
    delayMs: urgent ? 0 : delayBetweenMessagesMs(persona),
    typing,
    healthScore,
    dailyCap,
    sentToday,
  };
}
