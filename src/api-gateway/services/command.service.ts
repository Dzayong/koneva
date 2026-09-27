import pool from '../../shared/database/connection';
import config from '../../shared/config';
import { getRedisClient } from '../../shared/redis';
import { commandChannel, STATUS_DAILY_LIMIT, type CommandType } from '../../shared/commands';
import { ServiceError } from './service-error';
import { assertSubscriptionActive } from './billing.service';

/** Commands that WRITE to WhatsApp. Reads (profile.get) stay available to a suspended workspace: it keeps its numbers and data. */
const WRITE_COMMANDS: ReadonlySet<CommandType> = new Set(['status.post', 'profile.update', 'profile.picture']);

export interface CommandRow {
  views?: number;
  id: string; type: string; status: string; payload: unknown; result: unknown; error: string | null;
  run_at: Date; created_at: Date; finished_at: Date | null;
}

const COLUMNS = 'id, type, status, payload, result, error, run_at, created_at, finished_at';

async function findDevice(tenantId: string, deviceKey: string) {
  const device = (await pool.query<{ id: string; status: string }>(
    'SELECT id, status FROM devices WHERE tenant_id = $1 AND device_key = $2', [tenantId, deviceKey],
  )).rows[0];
  if (!device) throw new ServiceError(404, 'DEVICE_NOT_FOUND', 'Device not found');
  return device;
}

export interface EnqueueOptions { runAt?: Date }

export async function enqueueCommand(
  tenantId: string, deviceKey: string, type: CommandType, payload: unknown, options: EnqueueOptions = {},
): Promise<CommandRow> {
  const device = await findDevice(tenantId, deviceKey);
  if (device.status === 'banned') throw new ServiceError(409, 'DEVICE_BANNED', 'This number is banned; commands are not accepted');
  if (WRITE_COMMANDS.has(type)) {
    await assertSubscriptionActive(pool, tenantId); // 402 PLAN_INACTIVE for a suspended/expired workspace
    if (device.status === 'paused') throw new ServiceError(409, 'DEVICE_PAUSED', 'This number is paused; posts and profile changes are not accepted until it is resumed');
  }

  if (type === 'status.post') {
    const used = (await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM device_commands
       WHERE device_id = $1 AND type = 'status.post' AND status IN ('queued', 'running', 'done')
         AND (created_at AT TIME ZONE 'Asia/Jakarta')::date = (now() AT TIME ZONE 'Asia/Jakarta')::date`, [device.id],
    )).rows[0]?.n ?? 0;
    if (used >= STATUS_DAILY_LIMIT) {
      throw new ServiceError(429, 'STATUS_LIMIT', `At most ${STATUS_DAILY_LIMIT} status posts per number per day`);
    }
  }

  const row = (await pool.query<CommandRow>(
    `INSERT INTO device_commands (tenant_id, device_id, device_key, type, payload, run_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, COALESCE($6::timestamptz, now())) RETURNING ${COLUMNS}`,
    [tenantId, device.id, deviceKey, type, JSON.stringify(payload ?? {}), options.runAt ?? null],
  )).rows[0]!;
  // Wake the bot right away; it also polls, so a lost publish only costs a few seconds.
  await getRedisClient(config.redis.url).publish(commandChannel(deviceKey), row.id).catch(() => undefined);
  return row;
}

export async function getCommand(tenantId: string, deviceKey: string, id: string): Promise<CommandRow> {
  const row = (await pool.query<CommandRow>(
    `SELECT ${COLUMNS} FROM device_commands WHERE id = $1 AND tenant_id = $2 AND device_key = $3`, [id, tenantId, deviceKey],
  )).rows[0];
  if (!row) throw new ServiceError(404, 'COMMAND_NOT_FOUND', 'Command not found');
  return row;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs a command and waits for the bot's answer; used for reads and quick edits. */
export async function runCommand(
  tenantId: string, deviceKey: string, type: CommandType, payload: unknown, timeoutMs = 20_000,
): Promise<unknown> {
  const queued = await enqueueCommand(tenantId, deviceKey, type, payload);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(350);
    const row = await getCommand(tenantId, deviceKey, queued.id);
    if (row.status === 'done') return row.result;
    if (row.status === 'failed') throw commandFailure(row.error);
    if (row.status === 'cancelled') throw new ServiceError(409, 'COMMAND_CANCELLED', 'Command was cancelled');
  }
  // Leave it queued for the bot rather than cancelling: an edit may still complete after we gave up waiting.
  throw new ServiceError(504, 'DEVICE_NOT_RESPONDING', 'The number did not answer in time. Is it online?');
}

/** The bot stores failures as "CODE: message"; turn them into an API error. */
export function commandFailure(error: string | null): ServiceError {
  const match = /^([A-Z_]+): (.*)$/s.exec(error ?? '');
  const code = match?.[1] ?? 'COMMAND_FAILED';
  const status = code === 'NOT_BUSINESS' ? 409 : code === 'NOT_CONNECTED' ? 503 : code === 'NO_AUDIENCE' ? 400 : code === 'WA_TIMEOUT' ? 504 : 502;
  return new ServiceError(status, code, match?.[2] ?? error ?? 'Command failed');
}

export async function listCommands(tenantId: string, deviceKey: string, type: CommandType, limit = 30): Promise<CommandRow[]> {
  await findDevice(tenantId, deviceKey);
  return (await pool.query<CommandRow>(
    `SELECT ${COLUMNS.split(', ').map((c) => `c.${c}`).join(', ')},
       (SELECT COUNT(*)::int FROM status_views v WHERE v.device_id = c.device_id AND v.status_message_id = c.result->>'message_id') AS views
     FROM device_commands c WHERE c.tenant_id = $1 AND c.device_key = $2 AND c.type = $3
     ORDER BY c.created_at DESC LIMIT $4`, [tenantId, deviceKey, type, Math.min(Math.max(limit, 1), 100)],
  )).rows;
}

/**
 * Read results (profile: name, About, business email and address) hold personal data such as the shop's email and address, so
 * they are dropped after a day; status posts keep 30 days of history for the daily limit and the history list.
 */
export async function purgeOldCommands(): Promise<number> {
  const reads = await pool.query(
    `DELETE FROM device_commands WHERE type <> 'status.post' AND finished_at < now() - interval '1 day'`,
  );
  const posts = await pool.query(
    `DELETE FROM device_commands WHERE type = 'status.post' AND finished_at < now() - interval '30 days'`,
  );
  return (reads.rowCount ?? 0) + (posts.rowCount ?? 0);
}

/** Who opened one of our Status posts. Only people with read receipts on appear, so this is a lower bound. */
export async function listStatusViewers(tenantId: string, deviceKey: string, commandId: string) {
  const command = await getCommand(tenantId, deviceKey, commandId);
  const messageId = (command.result as { message_id?: string | null } | null)?.message_id;
  if (!messageId) return { viewers: [], total: 0 };
  const rows = (await pool.query<{ viewer: string; viewed_at: Date }>(
    `SELECT v.viewer, v.viewed_at FROM status_views v JOIN devices d ON d.id = v.device_id
     WHERE d.device_key = $1 AND d.tenant_id = $2 AND v.status_message_id = $3 ORDER BY v.viewed_at`, [deviceKey, tenantId, messageId],
  )).rows;
  return { viewers: rows.map((r) => ({ number: r.viewer.startsWith('lid:') ? null : r.viewer, viewed_at: r.viewed_at })), total: rows.length };
}

export async function cancelCommand(tenantId: string, deviceKey: string, id: string): Promise<CommandRow> {
  const row = (await pool.query<CommandRow>(
    `UPDATE device_commands SET status = 'cancelled', finished_at = now()
     WHERE id = $1 AND tenant_id = $2 AND device_key = $3 AND status = 'queued' RETURNING ${COLUMNS}`, [id, tenantId, deviceKey],
  )).rows[0];
  if (!row) throw new ServiceError(409, 'NOT_CANCELLABLE', 'Only queued commands can be cancelled');
  return row;
}
