import type { QueryFn } from './persona';

export const DEFAULT_WORK_HOURS = { enabled: true, start_time: '08:00', end_time: '22:00' } as const;
export interface WorkHours { enabled: boolean; start_time: string; end_time: string }

export async function getWorkspaceWorkHours(tenantId: string, queryFn: QueryFn): Promise<WorkHours> {
  const result = await queryFn(
    'SELECT enabled, to_char(start_time, \'HH24:MI\') AS start_time, to_char(end_time, \'HH24:MI\') AS end_time FROM workspace_send_hours WHERE tenant_id=$1',
    [tenantId],
  );
  const row = result.rows[0] as Partial<WorkHours> | undefined;
  return row?.start_time && row.end_time
    ? { enabled: row.enabled ?? true, start_time: row.start_time, end_time: row.end_time }
    : { ...DEFAULT_WORK_HOURS };
}

function jakartaMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  return Number(parts.find((part) => part.type === 'hour')?.value ?? 0) * 60
    + Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
}

function minutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

export function isWithinWorkspaceWorkHours(hours: WorkHours, now: Date): boolean {
  if (!hours.enabled) return true;
  const current = jakartaMinutes(now);
  return current >= minutes(hours.start_time) && current < minutes(hours.end_time);
}

export function msUntilWorkspaceWorkHoursOpen(hours: WorkHours, now: Date): number {
  if (!hours.enabled || isWithinWorkspaceWorkHours(hours, now)) return 0;
  const current = jakartaMinutes(now);
  const start = minutes(hours.start_time);
  const until = current < start ? start - current : 24 * 60 - current + start;
  return until * 60_000;
}
