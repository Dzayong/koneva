import logger from '../shared/utils/logger';
import { getDeviceByKey, type QueryFn } from './health-score';

export type { QueryFn };
import { evaluateContent, type RecipientMessage } from './content-filter';
import { hasRecipientOptedOut } from '../shared/readiness';
import {
  delayBetweenMessagesMs, evaluateFatigue, getBurstState, getOrCreatePersona,
} from '../shared/persona';
import { getWorkspaceWorkHours, isWithinWorkspaceWorkHours, msUntilWorkspaceWorkHoursOpen } from '../shared/work-hours';

const MIN_TYPING_MS = 1_500;
const MAX_TYPING_MS = 12_000;
const DEFAULT_TYPING_MS_PER_CHAR = 55;
const PER_MINUTE_LIMIT = 2;
const URGENT_PER_MINUTE_LIMIT = 20;

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

export type AntiBanDenialReason =
  | 'device_not_found'
  | 'device_paused'
  | 'device_banned'
  | 'resting'
  | 'recipient_opted_out'
  | 'rate_limit_per_minute'
  | 'outside_working_hours'
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

export async function countMessagesSince(deviceId: string, since: Date, queryFn: QueryFn): Promise<number> {
  const result = await queryFn(
    `SELECT COUNT(*) AS count FROM messages
     WHERE device_id=$1 AND direction='outbound'
       AND (status IN ('sending','sent','delivered','read') OR (status='failed' AND error_message='delivery_uncertain'))
       AND COALESCE(sent_at, send_started_at, created_at) >= $2`,
    [deviceId, since],
  );
  return Number(result.rows[0]?.['count'] ?? 0);
}

export interface CanSendMessageOptions {
  /** 'urgent' (OTP, transactional) skips pacing, rests and content rules. */
  priority?: MessagePriority | undefined;
  isProactive?: boolean | undefined;
  hasMedia?: boolean | undefined;
  content?: string | undefined;
  recipient?: string | undefined;
  recipientName?: string | undefined;
  requirePersonalization?: boolean | undefined;
  recentMessages?: string[] | undefined;
  recentByRecipient?: RecipientMessage[] | undefined;
  scheduleContext?: 'auto_reply' | 'broadcast' | undefined;
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

  // A banned number will never send again: fail its messages now instead of re-queueing them forever.
  if (device.status === 'banned') {
    return denial('device_banned', { healthScore: device.healthScore });
  }
  if (device.status === 'paused') {
    return denial('device_paused', { healthScore: device.healthScore });
  }

  // Honoring "stop" requests is a hard rule for proactive sends, independent of score.
  const urgent = options.priority === 'urgent';
  if (!urgent && options.isProactive && options.recipient && (await hasRecipientOptedOut(device.id, options.recipient, queryFn))) {
    return denial('recipient_opted_out', { healthScore: device.healthScore });
  }

  const healthScore = device.healthScore;
  const persona = await getOrCreatePersona(device.id, queryFn);
  // Daily caps and score-triggered pauses were removed by product decision.
  // Keep these legacy fields neutral for queue integrations during rollout.
  const dailyCap = 0;
  const sentToday = 0;

  const sentLastMinute = await countMessagesSince(device.id, new Date(now.getTime() - 60_000), queryFn);
  if (sentLastMinute >= (urgent ? URGENT_PER_MINUTE_LIMIT : PER_MINUTE_LIMIT)) {
    return denial('rate_limit_per_minute', { healthScore, dailyCap, sentToday });
  }

  if (!urgent && options.scheduleContext) {
    const hours = await getWorkspaceWorkHours(device.tenantId, queryFn);
    if (!isWithinWorkspaceWorkHours(hours, now)) {
      return denial('outside_working_hours', {
        retryAfterMs: msUntilWorkspaceWorkHoursOpen(hours, now) + Math.round(Math.random() * 60_000),
      });
    }
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
