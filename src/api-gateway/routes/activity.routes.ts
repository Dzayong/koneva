import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import pool from '../../shared/database/connection';
import {
  delayMode, evaluateFatigue, getBurstState, getOrCreatePersona,
  type Persona,
} from '../../shared/persona';
import { PRESETS, PRESET_IDS, presetValuesFor } from '../../shared/presets';
import { validate } from '../middleware/validate';
import { ServiceError } from '../services/service-error';

const router = Router();
const deviceParams = z.object({ key: z.string().min(1).max(32) });
const eventsQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });
const activityQuery = z.object({ days: z.coerce.number().int().min(1).max(60).default(14) });

const timezone = z.string().min(1).max(64).refine((tz) => {
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
}, 'Unknown time zone');

const personaPatch = z.object({
  timezone: timezone.optional(),
  wake_hour: z.number().min(0).max(23.75).optional(),
  sleep_hour: z.number().min(0.25).max(24).optional(),
  delay_min_ms: z.number().int().min(1_000).max(600_000).optional(),
  delay_max_ms: z.number().int().min(1_000).max(600_000).optional(),
  burst_size: z.number().int().min(2).max(60).optional(),
  rest_min_ms: z.number().int().min(60_000).max(7_200_000).optional(),
  rest_max_ms: z.number().int().min(60_000).max(7_200_000).optional(),
  typing_ms_per_char: z.number().int().min(20).max(200).optional(),
  typing_enabled: z.boolean().optional(),
  // Shortcut for a fixed delay: sets both delay_min_ms and delay_max_ms.
  delay_ms: z.number().int().min(1_000).max(600_000).optional(),
  always_on: z.boolean().optional(),
  presence_enabled: z.boolean().optional(),
  presence_min_ms: z.number().int().min(1_000).max(600_000).optional(),
  presence_max_ms: z.number().int().min(1_000).max(600_000).optional(),
}).strict();

function publicPersona(p: Persona) {
  return {
    timezone: p.timezone, wake_hour: p.wakeHour, sleep_hour: p.sleepHour,
    delay_min_ms: p.delayMinMs, delay_max_ms: p.delayMaxMs, burst_size: p.burstSize,
    delay_mode: delayMode(p),
    rest_min_ms: p.restMinMs, rest_max_ms: p.restMaxMs, typing_ms_per_char: p.typingMsPerChar,
    typing_enabled: p.typingEnabled,
    always_on: p.alwaysOn,
    presence_enabled: p.presenceEnabled, presence_min_ms: p.presenceMinMs, presence_max_ms: p.presenceMaxMs,
    preset: p.preset ?? 'custom',
  };
}

async function findDevice(request: Request): Promise<{ id: string; status: string }> {
  const { key } = request.validated!.params as { key: string };
  const { rows } = await pool.query(
    'SELECT id, status FROM devices WHERE tenant_id = $1 AND device_key = $2',
    [request.tenant!.id, key],
  );
  const device = rows[0] as { id: string; status: string } | undefined;
  if (!device) throw new ServiceError(404, 'DEVICE_NOT_FOUND', 'Device not found');
  return device;
}

const DAILY_SQL = `
  WITH days AS (
    SELECT generate_series((now() AT TIME ZONE $3::text)::date - ($2::int - 1), (now() AT TIME ZONE $3::text)::date, interval '1 day')::date AS d
  ),
  m AS (
    SELECT ((COALESCE(sent_at, created_at) AT TIME ZONE 'UTC') AT TIME ZONE $3::text) AS local_at, direction
    FROM messages
    WHERE device_id = $1::uuid AND system_otp=false AND system_notification=false AND created_at >= now() - make_interval(days => $2::int + 1)
      AND (direction = 'inbound' OR status IN ('sent', 'delivered', 'read'))
  )
  SELECT days.d AS date,
         COUNT(m.local_at) FILTER (WHERE m.direction = 'outbound')::int AS sent,
         COUNT(m.local_at) FILTER (WHERE m.direction = 'inbound')::int AS received,
         COUNT(DISTINCT date_trunc('hour', m.local_at))::int AS active_hours,
         to_char(MIN(m.local_at), 'HH24:MI') AS first_at,
         to_char(MAX(m.local_at), 'HH24:MI') AS last_at
  FROM days LEFT JOIN m ON m.local_at::date = days.d
  GROUP BY days.d ORDER BY days.d`;

export async function deviceActivity(request: Request, response: Response): Promise<void> {
  const { days } = request.validated!.query as z.infer<typeof activityQuery>;
  const device = await findDevice(request);
  const query = (text: string, params?: unknown[]) => pool.query(text, params);
  const persona = await getOrCreatePersona(device.id, query);
  const now = new Date();

  const [daily, burst] = await Promise.all([
    pool.query(DAILY_SQL, [device.id, days, persona.timezone]),
    getBurstState(device.id, query),
  ]);
  const rows = daily.rows as { date: Date; sent: number; received: number; active_hours: number; first_at: string | null; last_at: string | null }[];

  // Streak counts consecutive days with any real activity, ending today; an empty
  // today does not break it until the day is over.
  let streak = 0;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i]!;
    const active = row.sent + row.received > 0;
    if (active) streak += 1;
    else if (i !== rows.length - 1) break;
  }

  const fatigue = evaluateFatigue(persona, burst, now);
  response.json({
    success: true,
    data: {
      persona: publicPersona(persona),
      fatigue: {
        burst_count: burst.burstCount, burst_limit: fatigue.burstLimit,
        resting: fatigue.resting, rest_ends_at: fatigue.restEndsAt?.toISOString() ?? null,
      },
      streak_days: streak,
      daily: rows.map((row) => ({ ...row, date: new Date(row.date).toISOString().slice(0, 10) })),
    },
  });
}

export async function deviceEvents(request: Request, response: Response): Promise<void> {
  const { limit } = request.validated!.query as z.infer<typeof eventsQuery>;
  const device = await findDevice(request);
  const { rows } = await pool.query(
    `SELECT status, previous_status, reason, code, created_at
     FROM device_events WHERE device_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [device.id, limit],
  );
  response.json({ success: true, data: rows });
}

const presetBody = z.object({ preset: z.enum(PRESET_IDS) }).strict();

export async function listPresets(_request: Request, response: Response): Promise<void> {
  response.json({ success: true, data: Object.values(PRESETS) });
}

export async function applyPreset(request: Request, response: Response): Promise<void> {
  const device = await findDevice(request);
  const { preset } = request.validated!.body as z.infer<typeof presetBody>;
  const current = await getOrCreatePersona(device.id, (text, params) => pool.query(text, params));
  const v = presetValuesFor(preset, current.seed);
  await pool.query(
    `UPDATE device_personas SET wake_hour=$2, sleep_hour=$3, delay_min_ms=$4, delay_max_ms=$5, burst_size=$6,
       rest_min_ms=$7, rest_max_ms=$8, typing_ms_per_char=$9, always_on=$10, preset=$11, updated_at=now()
     WHERE device_id=$1`,
    [device.id, v.wakeHour, v.sleepHour, v.delayMinMs, v.delayMaxMs, v.burstSize, v.restMinMs, v.restMaxMs, v.typingMsPerChar, v.alwaysOn, preset],
  );
  response.json({ success: true, data: publicPersona({ ...current, ...v, preset }) });
}

export async function getPersona(request: Request, response: Response): Promise<void> {
  const device = await findDevice(request);
  const persona = await getOrCreatePersona(device.id, (text, params) => pool.query(text, params));
  response.json({ success: true, data: publicPersona(persona) });
}

export async function updatePersona(request: Request, response: Response): Promise<void> {
  const device = await findDevice(request);
  const patch = request.validated!.body as z.infer<typeof personaPatch>;
  const current = await getOrCreatePersona(device.id, (text, params) => pool.query(text, params));
  if (patch.delay_ms !== undefined && (patch.delay_min_ms !== undefined || patch.delay_max_ms !== undefined)) {
    throw new ServiceError(400, 'VALIDATION_ERROR', 'Use either delay_ms (fixed) or delay_min_ms/delay_max_ms (random), not both');
  }
  const next = {
    timezone: patch.timezone ?? current.timezone,
    wake_hour: patch.wake_hour ?? current.wakeHour, sleep_hour: patch.sleep_hour ?? current.sleepHour,
    delay_min_ms: patch.delay_ms ?? patch.delay_min_ms ?? current.delayMinMs,
    delay_max_ms: patch.delay_ms ?? patch.delay_max_ms ?? current.delayMaxMs,
    always_on: patch.always_on ?? current.alwaysOn,
    presence_enabled: patch.presence_enabled ?? current.presenceEnabled,
    presence_min_ms: patch.presence_min_ms ?? current.presenceMinMs,
    presence_max_ms: patch.presence_max_ms ?? current.presenceMaxMs,
    burst_size: patch.burst_size ?? current.burstSize,
    rest_min_ms: patch.rest_min_ms ?? current.restMinMs, rest_max_ms: patch.rest_max_ms ?? current.restMaxMs,
    typing_ms_per_char: patch.typing_ms_per_char ?? current.typingMsPerChar,
    typing_enabled: patch.typing_enabled ?? current.typingEnabled,
  };
  if (next.wake_hour >= next.sleep_hour) throw new ServiceError(400, 'VALIDATION_ERROR', 'wake_hour must be earlier than sleep_hour');
  if (next.delay_max_ms < next.delay_min_ms) throw new ServiceError(400, 'VALIDATION_ERROR', 'delay_max_ms must be >= delay_min_ms');
  if (next.presence_max_ms < next.presence_min_ms) throw new ServiceError(400, 'VALIDATION_ERROR', 'presence_max_ms must be >= presence_min_ms');
  if (next.rest_max_ms < next.rest_min_ms) throw new ServiceError(400, 'VALIDATION_ERROR', 'rest_max_ms must be >= rest_min_ms');

  await pool.query(
    `UPDATE device_personas SET timezone=$2, wake_hour=$3, sleep_hour=$4, delay_min_ms=$5, delay_max_ms=$6,
       burst_size=$7, rest_min_ms=$8, rest_max_ms=$9, typing_ms_per_char=$10, always_on=$11, presence_enabled=$12, presence_min_ms=$13, presence_max_ms=$14,
       preset=NULL, typing_enabled=$15, updated_at=now()
     WHERE device_id=$1`,
    [device.id, next.timezone, next.wake_hour, next.sleep_hour, next.delay_min_ms, next.delay_max_ms,
      next.burst_size, next.rest_min_ms, next.rest_max_ms, next.typing_ms_per_char, next.always_on,
      next.presence_enabled, next.presence_min_ms, next.presence_max_ms, next.typing_enabled],
  );
  response.json({ success: true, data: { ...next, delay_mode: next.delay_min_ms === next.delay_max_ms ? 'flat' : 'random' } });
}

router.get('/devices/:key/activity', validate({ params: deviceParams, query: activityQuery }), deviceActivity);
router.get('/devices/:key/events', validate({ params: deviceParams, query: eventsQuery }), deviceEvents);
router.get('/presets', listPresets);
router.post('/devices/:key/preset', validate({ params: deviceParams, body: presetBody }), applyPreset);
router.get('/devices/:key/persona', validate({ params: deviceParams }), getPersona);
router.patch('/devices/:key/persona', validate({ params: deviceParams, body: personaPatch }), updatePersona);
export default router;
