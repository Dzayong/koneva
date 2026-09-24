import logger from '../shared/utils/logger';
import { getDeviceByKey, getDeliveryMetrics, calculateHealthScore, type QueryFn } from './health-score';

export type { QueryFn };
import { evaluateContent, type RecipientMessage } from './content-filter';

const MIN_SAMPLES_FOR_PAUSE = 10;
const FALLBACK_CAP_WHEN_UNPROVEN = 5;

export interface WarmupStage {
  minDay: number;
  maxMessagesPerDay: number;
  proactiveAllowed: boolean;
  mediaAllowed: boolean;
}

const WARMUP_STAGES: WarmupStage[] = [
  { minDay: 1, maxMessagesPerDay: 5, proactiveAllowed: false, mediaAllowed: false },
  { minDay: 3, maxMessagesPerDay: 10, proactiveAllowed: true, mediaAllowed: false },
  { minDay: 5, maxMessagesPerDay: 20, proactiveAllowed: true, mediaAllowed: true },
  { minDay: 8, maxMessagesPerDay: 50, proactiveAllowed: true, mediaAllowed: true },
];

export function getWarmupStage(warmupDay: number): WarmupStage {
  let selected = WARMUP_STAGES[0]!;
  for (const stage of WARMUP_STAGES) {
    if (warmupDay >= stage.minDay) {
      selected = stage;
    }
  }
  return selected;
}

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

const MIN_BASE_DELAY_MS = 15_000;
const MAX_BASE_DELAY_MS = 45_000;
const REST_EVERY_N_MESSAGES = 50;
const MIN_REST_MS = 10 * 60_000;
const MAX_REST_MS = 15 * 60_000;
const TYPING_CHANCE = 0.3;
const MIN_TYPING_MS = 2_000;
const MAX_TYPING_MS = 5_000;
const PER_MINUTE_LIMIT = 2;
const PAUSE_DURATION_MS = 24 * 60 * 60_000;
const DEFAULT_TIMEZONE = 'Asia/Jakarta';
const JAKARTA_UTC_OFFSET_MS = 7 * 60 * 60_000;
const SEND_WINDOW_START_HOUR = 8;
const SEND_WINDOW_END_HOUR = 22;

function randomBetween(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min));
}

export function getBaseDelayMs(): number {
  return randomBetween(MIN_BASE_DELAY_MS, MAX_BASE_DELAY_MS);
}

export function shouldRest(messagesSentToday: number): boolean {
  return messagesSentToday > 0 && messagesSentToday % REST_EVERY_N_MESSAGES === 0;
}

export function getRestDurationMs(): number {
  return randomBetween(MIN_REST_MS, MAX_REST_MS);
}

export interface TypingSimulation {
  shouldSimulate: boolean;
  durationMs: number;
}

export function getTypingSimulation(): TypingSimulation {
  const shouldSimulate = Math.random() < TYPING_CHANCE;
  return { shouldSimulate, durationMs: shouldSimulate ? randomBetween(MIN_TYPING_MS, MAX_TYPING_MS) : 0 };
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
    `SELECT COUNT(*) AS count FROM messages WHERE device_id = $1 AND created_at >= $2`,
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

async function markWarmupCompleted(deviceId: string, now: Date, queryFn: QueryFn): Promise<void> {
  await queryFn(
    `UPDATE devices SET warmup_completed_at = $1, updated_at = now()
     WHERE id = $2 AND warmup_completed_at IS NULL`,
    [now, deviceId],
  );
}

export type AntiBanDenialReason =
  | 'device_not_found'
  | 'device_paused'
  | 'health_score_too_low'
  | 'daily_cap_reached'
  | 'rate_limit_per_minute'
  | 'outside_sending_window'
  | 'proactive_not_allowed_in_warmup'
  | 'media_not_allowed_in_warmup'
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
  warmupDay: number;
}

export interface CanSendMessageOptions {
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
  extra: Partial<Pick<AntiBanDecision, 'healthScore' | 'dailyCap' | 'sentToday' | 'warmupDay'>> = {},
): AntiBanDecision {
  return {
    allowed: false,
    reason,
    delayMs: 0,
    typing: { shouldSimulate: false, durationMs: 0 },
    healthScore: extra.healthScore ?? 0,
    dailyCap: extra.dailyCap ?? 0,
    sentToday: extra.sentToday ?? 0,
    warmupDay: extra.warmupDay ?? 0,
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
  const isAdministrativelyPaused = device.status === 'paused' || device.status === 'banned';
  const isAutoPaused = device.pausedUntil !== null && device.pausedUntil.getTime() > now.getTime();
  if (isAdministrativelyPaused || isAutoPaused) {
    return denial('device_paused', { healthScore: device.healthScore });
  }

  const healthScore = await calculateHealthScore(deviceKey, queryFn);
  const metrics = await getDeliveryMetrics(device.id, queryFn);
  const rawHealthCap = getDailyCapByHealthScore(healthScore);

  // A device with too little history to judge fairly must not be paused purely
  // for lacking data; warm-up caps already keep it slow until it earns a real score.
  const healthCap =
    rawHealthCap === null && metrics.totalSent < MIN_SAMPLES_FOR_PAUSE
      ? FALLBACK_CAP_WHEN_UNPROVEN
      : rawHealthCap;

  if (healthCap === null) {
    await pauseDevice(device.id, now, queryFn);
    return denial('health_score_too_low', { healthScore });
  }

  const warmupStart = device.warmupStartedAt ?? device.createdAt;
  const warmupDay = Math.floor((now.getTime() - warmupStart.getTime()) / 86_400_000) + 1;
  const stage = getWarmupStage(warmupDay);

  if (warmupDay >= 8 && !device.warmupCompletedAt) {
    await markWarmupCompleted(device.id, now, queryFn);
  }

  const dailyCap = Math.min(stage.maxMessagesPerDay, healthCap);
  const sentToday = await countMessagesSince(device.id, startOfDayJakartaUtc(now), queryFn);

  if (sentToday >= dailyCap) {
    return denial('daily_cap_reached', { healthScore, dailyCap, sentToday, warmupDay });
  }

  const sentLastMinute = await countMessagesSince(device.id, new Date(now.getTime() - 60_000), queryFn);
  if (sentLastMinute >= PER_MINUTE_LIMIT) {
    return denial('rate_limit_per_minute', { healthScore, dailyCap, sentToday, warmupDay });
  }

  if (!isWithinSendingWindow(now, { timeZone: options.timeZone, blockFridayLunch: options.blockFridayLunch })) {
    return denial('outside_sending_window', { healthScore, dailyCap, sentToday, warmupDay });
  }

  if (options.isProactive && !stage.proactiveAllowed) {
    return denial('proactive_not_allowed_in_warmup', { healthScore, dailyCap, sentToday, warmupDay });
  }

  if (options.hasMedia && !stage.mediaAllowed) {
    return denial('media_not_allowed_in_warmup', { healthScore, dailyCap, sentToday, warmupDay });
  }

  if (options.content !== undefined) {
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
        warmupDay,
      };
    }
  }

  const rest = shouldRest(sentToday) ? getRestDurationMs() : 0;
  const typing = getTypingSimulation();

  logger.info('Message send approved', {
    deviceKey,
    deviceId: device.id,
    healthScore,
    dailyCap,
    sentToday,
    warmupDay,
  });

  return {
    allowed: true,
    delayMs: getBaseDelayMs() + rest,
    typing,
    healthScore,
    dailyCap,
    sentToday,
    warmupDay,
  };
}
