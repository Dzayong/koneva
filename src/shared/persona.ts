import { createHash, randomBytes } from 'node:crypto';

// A persona gives every number its own stable habits, so a fleet of numbers
// does not share one machine-like rhythm. Values are drawn once from a seed
// (kept in the DB) and every per-day / per-burst variation is derived from that
// same seed, so a decision is repeatable when it is evaluated more than once.

export type QueryFn = (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

export interface Persona {
  seed: string;
  timezone: string;
  wakeHour: number;
  sleepHour: number;
  delayMinMs: number;
  delayMaxMs: number;
  burstSize: number;
  restMinMs: number;
  restMaxMs: number;
  typingMsPerChar: number;
  /** 24-hour mode: no active-hours window (pacing and rests still apply). */
  alwaysOn: boolean;
  /** Preset the number was last set to; null/undefined when hand-tuned. */
  preset?: string | null | undefined;
}

export const BURST_GAP_SECONDS = 180;

export function unit(seed: string, label: string): number {
  const digest = createHash('sha256').update(`${seed}|${label}`).digest();
  return digest.readUInt32BE(0) / 0x1_0000_0000;
}

const round = (value: number, step: number): number => Math.round(value / step) * step;

export function generatePersona(seed: string, timezone = 'Asia/Jakarta'): Persona {
  const delayMinMs = Math.round((8 + unit(seed, 'dmin') * 12) * 1000);
  const restMinMs = Math.round((4 + unit(seed, 'rmin') * 4) * 60_000);
  return {
    seed,
    timezone,
    wakeHour: round(6 + unit(seed, 'wake') * 2.5, 0.25),
    sleepHour: round(21 + unit(seed, 'sleep') * 2.5, 0.25),
    delayMinMs,
    delayMaxMs: delayMinMs + Math.round((20 + unit(seed, 'dmax') * 35) * 1000),
    burstSize: 6 + Math.floor(unit(seed, 'burst') * 10),
    restMinMs,
    restMaxMs: restMinMs + Math.round((5 + unit(seed, 'rmax') * 8) * 60_000),
    typingMsPerChar: 45 + Math.floor(unit(seed, 'type') * 36),
    alwaysOn: false,
  };
}

function localParts(date: Date, timeZone: string): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '0';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) + Number(get('minute')) / 60 };
}

/** Today's active window in local decimal hours; edges drift up to 20 minutes per day. */
export function activeWindow(persona: Persona, now: Date): { start: number; end: number } {
  const { day } = localParts(now, persona.timezone);
  const drift = (label: string): number => (unit(persona.seed, `${label}:${day}`) - 0.5) * (2 / 3);
  return { start: persona.wakeHour + drift('ws'), end: persona.sleepHour + drift('se') };
}

export function isWithinPersonaWindow(persona: Persona, now: Date = new Date()): boolean {
  if (persona.alwaysOn) return true;
  const { hour } = localParts(now, persona.timezone);
  const { start, end } = activeWindow(persona, now);
  return hour >= start && hour < end;
}

/** Milliseconds until the persona wakes up next (0 when already inside the window). */
export function msUntilWindowOpens(persona: Persona, now: Date = new Date()): number {
  if (isWithinPersonaWindow(persona, now)) return 0;
  const { hour } = localParts(now, persona.timezone);
  const { start } = activeWindow(persona, now);
  const hours = hour < start ? start - hour : 24 - hour + start;
  return Math.round(hours * 3_600_000);
}

/** Milliseconds until tomorrow's wake-up time (used once the daily budget is spent). */
export function msUntilNextDayWindow(persona: Persona, now: Date = new Date()): number {
  const { hour } = localParts(now, persona.timezone);
  return Math.round((24 - hour + persona.wakeHour) * 3_600_000);
}

/** Daily volume never exceeds the cap; it only dips 0-20% so days are not identical. */
export function dailyFactor(persona: Persona, now: Date): number {
  const { day } = localParts(now, persona.timezone);
  return 0.8 + unit(persona.seed, `day:${day}`) * 0.2;
}

export function delayMode(persona: Persona): 'flat' | 'random' {
  return persona.delayMinMs === persona.delayMaxMs ? 'flat' : 'random';
}

export function delayBetweenMessagesMs(persona: Persona): number {
  return Math.round(persona.delayMinMs + Math.random() * (persona.delayMaxMs - persona.delayMinMs));
}

export interface BurstState {
  burstCount: number;
  burstStartAt: Date | null;
  lastAt: Date | null;
}

export interface Fatigue {
  resting: boolean;
  burstLimit: number;
  restEndsAt: Date | null;
}

export function evaluateFatigue(persona: Persona, state: BurstState, now: Date): Fatigue {
  if (!state.burstStartAt || !state.lastAt) return { resting: false, burstLimit: persona.burstSize, restEndsAt: null };
  const key = state.burstStartAt.toISOString();
  const burstLimit = Math.max(3, Math.round(persona.burstSize * (0.7 + unit(persona.seed, `burst:${key}`) * 0.6)));
  if (state.burstCount < burstLimit) return { resting: false, burstLimit, restEndsAt: null };
  const restMs = persona.restMinMs + unit(persona.seed, `rest:${key}`) * (persona.restMaxMs - persona.restMinMs);
  const restEndsAt = new Date(state.lastAt.getTime() + restMs);
  return { resting: now.getTime() < restEndsAt.getTime(), burstLimit, restEndsAt };
}

const BURST_SQL = `
  WITH s AS (
    SELECT COALESCE(sent_at, created_at) AS at FROM messages
    WHERE device_id = $1::uuid AND direction = 'outbound' AND status IN ('sent', 'delivered', 'read')
      AND COALESCE(sent_at, created_at) >= now() - interval '6 hours'
  ),
  g AS (SELECT at, at - LAG(at) OVER (ORDER BY at) AS gap FROM s),
  b AS (SELECT MAX(at) FILTER (WHERE gap IS NULL OR gap >= make_interval(secs => $2::int)) AS burst_start FROM g)
  SELECT (SELECT burst_start FROM b) AS burst_start,
         (SELECT COUNT(*) FROM g WHERE at >= (SELECT burst_start FROM b))::int AS burst_count,
         (SELECT MAX(at) FROM g) AS last_at`;

export async function getBurstState(deviceId: string, queryFn: QueryFn): Promise<BurstState> {
  const { rows } = await queryFn(BURST_SQL, [deviceId, BURST_GAP_SECONDS]);
  const row = rows[0];
  const toDate = (value: unknown): Date | null => (value ? new Date(value as string | Date) : null);
  return {
    burstCount: Number(row?.burst_count ?? 0),
    burstStartAt: toDate(row?.burst_start),
    lastAt: toDate(row?.last_at),
  };
}

interface PersonaRow {
  seed: string; timezone: string; wake_hour: number; sleep_hour: number; delay_min_ms: number; delay_max_ms: number;
  burst_size: number; rest_min_ms: number; rest_max_ms: number; typing_ms_per_char: number; always_on: boolean; preset?: string | null;
}

function fromRow(row: PersonaRow): Persona {
  return {
    seed: row.seed, timezone: row.timezone, wakeHour: Number(row.wake_hour), sleepHour: Number(row.sleep_hour),
    delayMinMs: row.delay_min_ms, delayMaxMs: row.delay_max_ms, burstSize: row.burst_size,
    restMinMs: row.rest_min_ms, restMaxMs: row.rest_max_ms, typingMsPerChar: row.typing_ms_per_char,
    alwaysOn: row.always_on === true,
    preset: row.preset ?? null,
  };
}

const SELECT_SQL = `SELECT seed, timezone, wake_hour, sleep_hour, delay_min_ms, delay_max_ms, burst_size,
  rest_min_ms, rest_max_ms, typing_ms_per_char, always_on, preset FROM device_personas WHERE device_id = $1::uuid`;

export async function getOrCreatePersona(deviceId: string, queryFn: QueryFn): Promise<Persona> {
  const existing = (await queryFn(SELECT_SQL, [deviceId])).rows[0] as PersonaRow | undefined;
  if (existing) return fromRow(existing);

  const p = generatePersona(randomBytes(16).toString('hex'));
  await queryFn(
    `INSERT INTO device_personas (device_id, seed, timezone, wake_hour, sleep_hour, delay_min_ms, delay_max_ms,
       burst_size, rest_min_ms, rest_max_ms, typing_ms_per_char)
     VALUES ($1::uuid, $2::varchar, $3::varchar, $4::real, $5::real, $6::int, $7::int, $8::int, $9::int, $10::int, $11::int)
     ON CONFLICT (device_id) DO NOTHING`,
    [deviceId, p.seed, p.timezone, p.wakeHour, p.sleepHour, p.delayMinMs, p.delayMaxMs, p.burstSize, p.restMinMs, p.restMaxMs, p.typingMsPerChar],
  );
  const stored = (await queryFn(SELECT_SQL, [deviceId])).rows[0] as PersonaRow | undefined;
  // Without a DB row (e.g. unit tests) fall back to a persona that is stable per device.
  return stored ? fromRow(stored) : generatePersona(deviceId);
}
