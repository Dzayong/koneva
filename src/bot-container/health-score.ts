import type Redis from 'ioredis';
import { query } from '../shared/database/connection';
import logger from '../shared/utils/logger';
import { computeReadiness, getReadinessInputs } from '../shared/readiness';

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
}

/** Real outbound sends in the last 30 days; sample size for auto-pause decisions. */
export async function getDeliveryMetrics(
  deviceId: string,
  queryFn: QueryFn = defaultQueryFn,
): Promise<DeliveryMetrics> {
  const { rows } = await queryFn(
    `SELECT COUNT(*) AS total_sent
     FROM messages
     WHERE device_id = $1 AND direction = 'outbound' AND status IN ('sent', 'delivered', 'read')
       AND created_at >= now() - make_interval(days => $2::int)`,
    [deviceId, METRICS_WINDOW_DAYS],
  );

  const row = rows[0] as { total_sent: string } | undefined;
  return { totalSent: Number(row?.total_sent ?? 0) };
}

export async function calculateHealthScore(
  deviceKey: string,
  queryFn: QueryFn = defaultQueryFn,
): Promise<number> {
  const device = await getDeviceByKey(deviceKey, queryFn);
  if (!device) {
    throw new Error(`Device not found: ${deviceKey}`);
  }

  const inputs = await getReadinessInputs(device, queryFn);
  const report = computeReadiness(inputs);

  await queryFn(`UPDATE devices SET health_score = $1, updated_at = now() WHERE id = $2`, [
    report.score,
    device.id,
  ]);

  logger.debug('Readiness score recalculated', {
    deviceKey,
    deviceId: device.id,
    score: report.score,
    tier: report.tier,
    confidence: report.confidence,
  });

  return report.score;
}
