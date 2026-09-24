import type Redis from 'ioredis';
import { query } from '../shared/database/connection';
import logger from '../shared/utils/logger';

export type QueryFn = (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

const defaultQueryFn: QueryFn = (text, params) => query(text, params);

const METRICS_WINDOW_DAYS = 30;

export interface DeviceRecord {
  id: string;
  tenantId: string;
  deviceKey: string;
  status: string;
  healthScore: number;
  createdAt: Date;
  warmupStartedAt: Date | null;
  warmupCompletedAt: Date | null;
  pausedUntil: Date | null;
}

interface DeviceRow {
  id: string;
  tenant_id: string;
  device_key: string;
  status: string;
  health_score: number;
  created_at: Date;
  warmup_started_at: Date | null;
  warmup_completed_at: Date | null;
  paused_until: Date | null;
}

function mapDeviceRow(row: DeviceRow): DeviceRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    deviceKey: row.device_key,
    status: row.status,
    healthScore: row.health_score,
    createdAt: row.created_at,
    warmupStartedAt: row.warmup_started_at,
    warmupCompletedAt: row.warmup_completed_at,
    pausedUntil: row.paused_until,
  };
}

export async function getDeviceByKey(
  deviceKey: string,
  queryFn: QueryFn = defaultQueryFn,
): Promise<DeviceRecord | undefined> {
  const { rows } = await queryFn(
    `SELECT id, tenant_id, device_key, status, health_score, created_at,
            warmup_started_at, warmup_completed_at, paused_until
     FROM devices WHERE device_key = $1`,
    [deviceKey],
  );

  const row = rows[0] as unknown as DeviceRow | undefined;
  return row ? mapDeviceRow(row) : undefined;
}

const DEVICE_CACHE_TTL_SECONDS = 3;

function deviceCacheKey(deviceKey: string): string {
  return `cache:device:${deviceKey}`;
}

/**
 * Read-only, short-TTL cache of the device row — for display endpoints
 * (e.g. GET /status) only. Never use this on the anti-ban decision path:
 * health score / pause state there must always read the live row.
 */
export async function getDeviceByKeyCached(
  deviceKey: string,
  redis: Redis,
  queryFn: QueryFn = defaultQueryFn,
): Promise<DeviceRecord | undefined> {
  const cacheKey = deviceCacheKey(deviceKey);

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as DeviceRecord;
      return {
        ...parsed,
        createdAt: new Date(parsed.createdAt),
        warmupStartedAt: parsed.warmupStartedAt ? new Date(parsed.warmupStartedAt) : null,
        warmupCompletedAt: parsed.warmupCompletedAt ? new Date(parsed.warmupCompletedAt) : null,
        pausedUntil: parsed.pausedUntil ? new Date(parsed.pausedUntil) : null,
      };
    }
  } catch (err) {
    logger.warn('Device cache read failed, falling back to database', {
      deviceKey,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const device = await getDeviceByKey(deviceKey, queryFn);
  if (device) {
    try {
      await redis.set(cacheKey, JSON.stringify(device), 'EX', DEVICE_CACHE_TTL_SECONDS);
    } catch (err) {
      logger.warn('Device cache write failed', {
        deviceKey,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return device;
}

export interface DeliveryMetrics {
  totalSent: number;
  delivered: number;
  replied: number;
  blocked: number;
  reported: number;
}

export async function getDeliveryMetrics(
  deviceId: string,
  queryFn: QueryFn = defaultQueryFn,
): Promise<DeliveryMetrics> {
  const { rows } = await queryFn(
    `SELECT
       COUNT(*) AS total_sent,
       COUNT(*) FILTER (WHERE delivered_at IS NOT NULL) AS delivered,
       COUNT(*) FILTER (WHERE replied_at IS NOT NULL) AS replied,
       COUNT(*) FILTER (WHERE status = 'blocked' OR blocked_at IS NOT NULL) AS blocked,
       COUNT(*) FILTER (WHERE reported_at IS NOT NULL) AS reported
     FROM messages
     WHERE device_id = $1 AND created_at >= now() - make_interval(days => $2::int)`,
    [deviceId, METRICS_WINDOW_DAYS],
  );

  const row = rows[0] as
    | { total_sent: string; delivered: string; replied: string; blocked: string; reported: string }
    | undefined;

  return {
    totalSent: Number(row?.total_sent ?? 0),
    delivered: Number(row?.delivered ?? 0),
    replied: Number(row?.replied ?? 0),
    blocked: Number(row?.blocked ?? 0),
    reported: Number(row?.reported ?? 0),
  };
}

export interface HealthScoreInputs {
  deviceAgeDays: number;
  warmupCompleted: boolean;
  totalSent: number;
  delivered: number;
  replied: number;
  blocked: number;
  reported: number;
}

export function computeHealthScore(inputs: HealthScoreInputs): number {
  let score = 0;

  if (inputs.deviceAgeDays > 30) {
    score += 20;
  } else if (inputs.deviceAgeDays > 7) {
    score += 10;
  }

  if (inputs.warmupCompleted) {
    score += 20;
  }

  if (inputs.totalSent > 0) {
    const deliveryRate = inputs.delivered / inputs.totalSent;
    if (deliveryRate > 0.95) {
      score += 20;
    } else if (deliveryRate > 0.9) {
      score += 10;
    }

    const replyRate = inputs.replied / inputs.totalSent;
    if (replyRate > 0.3) {
      score += 15;
    } else if (replyRate > 0.15) {
      score += 8;
    }

    const blockRate = inputs.blocked / inputs.totalSent;
    if (blockRate < 0.005) {
      score += 15;
    } else if (blockRate > 0.02) {
      score -= 20;
    }

    const reportRate = inputs.reported / inputs.totalSent;
    if (reportRate < 0.001) {
      score += 10;
    } else if (reportRate > 0.01) {
      score -= 30;
    }
  }

  return Math.max(0, Math.min(100, score));
}

export async function calculateHealthScore(
  deviceKey: string,
  queryFn: QueryFn = defaultQueryFn,
): Promise<number> {
  const device = await getDeviceByKey(deviceKey, queryFn);
  if (!device) {
    throw new Error(`Device not found: ${deviceKey}`);
  }

  const metrics = await getDeliveryMetrics(device.id, queryFn);
  const deviceAgeDays = Math.floor((Date.now() - device.createdAt.getTime()) / 86_400_000);

  const score = computeHealthScore({
    deviceAgeDays,
    warmupCompleted: device.warmupCompletedAt !== null,
    totalSent: metrics.totalSent,
    delivered: metrics.delivered,
    replied: metrics.replied,
    blocked: metrics.blocked,
    reported: metrics.reported,
  });

  await queryFn(`UPDATE devices SET health_score = $1, updated_at = now() WHERE id = $2`, [
    score,
    device.id,
  ]);

  logger.debug('Health score recalculated', { deviceKey, deviceId: device.id, score, metrics });

  return score;
}
