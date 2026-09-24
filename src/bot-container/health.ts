import type Redis from 'ioredis';
import pool from '../shared/database/connection';
import type { ConnectionState } from './types';

export interface DependencyStatus {
  db: boolean;
  redis: boolean;
  whatsapp: boolean;
}

export interface HealthReport {
  status: 'healthy' | 'degraded' | 'unhealthy';
  dependencies: DependencyStatus;
  detail?: Partial<Record<keyof DependencyStatus, string>>;
}

const CHECK_TIMEOUT_MS = 3_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

async function checkDb(): Promise<{ ok: boolean; detail?: string }> {
  try {
    await withTimeout(pool.query('SELECT 1'), CHECK_TIMEOUT_MS);
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

async function checkRedis(redis: Redis): Promise<{ ok: boolean; detail?: string }> {
  try {
    await withTimeout(redis.ping(), CHECK_TIMEOUT_MS);
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * WhatsApp isn't checked with a live call — the connection is a persistent
 * socket owned by connection.ts, so "healthy" here means "we believe the
 * socket is currently open", taken from the same in-memory state /status
 * and /ready already report. `db`/`redis` get real round-trip checks
 * because those are separate connections that can fail independently of
 * this process's own state.
 */
function checkWhatsApp(state: ConnectionState): { ok: boolean; detail?: string } {
  if (state.status === 'online') {
    return { ok: true };
  }
  return { ok: false, detail: `connection status is '${state.status}'` };
}

export async function getHealthReport(redis: Redis, state: ConnectionState): Promise<HealthReport> {
  const [db, redisResult] = await Promise.all([checkDb(), checkRedis(redis)]);
  const whatsapp = checkWhatsApp(state);

  const dependencies: DependencyStatus = { db: db.ok, redis: redisResult.ok, whatsapp: whatsapp.ok };
  const detail: HealthReport['detail'] = {};
  if (db.detail) detail.db = db.detail;
  if (redisResult.detail) detail.redis = redisResult.detail;
  if (whatsapp.detail) detail.whatsapp = whatsapp.detail;

  // db/redis down is unhealthy (this process can't do its job at all);
  // whatsapp down alone is degraded (still reachable, just not paired yet
  // or mid-reconnect, which is a normal transient state, not an outage).
  let status: HealthReport['status'] = 'healthy';
  if (!db.ok || !redisResult.ok) {
    status = 'unhealthy';
  } else if (!whatsapp.ok) {
    status = 'degraded';
  }

  return { status, dependencies, ...(Object.keys(detail).length > 0 ? { detail } : {}) };
}
