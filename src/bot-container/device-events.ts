import type { Logger } from 'winston';
import { dispatchWebhook } from './webhook';
import type { QueryFn } from './health-score';
import type { ConnectionState } from './types';

export type NotifiableStatus = 'online' | 'offline' | 'banned' | 'logged_out' | 'error';

/** Transitional states (connecting, reconnecting, qr_pending) are not worth a notification. */
export function notifiableStatus(state: ConnectionState): NotifiableStatus | undefined {
  switch (state.status) {
    case 'online': case 'offline': case 'banned': case 'logged_out': case 'error':
      return state.status;
    default:
      return undefined;
  }
}

const FROM_DB: Record<string, NotifiableStatus> = { online: 'online', offline: 'offline', banned: 'banned', error: 'error' };

export class DeviceStatusNotifier {
  private last: NotifiableStatus | undefined;
  private device: { id: string; tenantId: string } | undefined;

  constructor(
    private readonly deviceKey: string,
    private readonly queryFn: QueryFn,
    private readonly log: Logger,
    private readonly dispatch: typeof dispatchWebhook = dispatchWebhook,
  ) {}

  /** Start from the stored status so a restart or deploy does not look like a state change. */
  async init(): Promise<void> {
    const { rows } = await this.queryFn('SELECT id, tenant_id, status FROM devices WHERE device_key = $1', [this.deviceKey]);
    const row = rows[0] as { id: string; tenant_id: string; status: string } | undefined;
    if (!row) return;
    this.device = { id: row.id, tenantId: row.tenant_id };
    this.last = FROM_DB[row.status];
  }

  async handle(state: ConnectionState): Promise<void> {
    const next = notifiableStatus(state);
    if (!next || next === this.last || !this.device) return;
    const previous = this.last;
    this.last = next;
    const reason = next === 'online' ? undefined : state.lastDisconnectReason;
    try {
      await this.queryFn(
        `INSERT INTO device_events (device_id, tenant_id, device_key, status, previous_status, reason, code)
         VALUES ($1::uuid, $2::uuid, $3::varchar, $4::varchar, $5::varchar, $6::varchar, $7::int)`,
        [this.device.id, this.device.tenantId, this.deviceKey, next, previous ?? null, reason ?? null, state.disconnectCode ?? null],
      );
      await this.dispatch(this.device.tenantId, {
        event: 'device.status_changed',
        device_key: this.deviceKey,
        status: next,
        ...(previous ? { previous_status: previous } : {}),
        ...(reason ? { reason } : {}),
        ...(state.disconnectCode !== undefined ? { code: state.disconnectCode } : {}),
        timestamp: new Date().toISOString(),
      }, { queryFn: this.queryFn });
      this.log.warn('Device status changed', { deviceKey: this.deviceKey, status: next, previous, reason });
    } catch (error) {
      this.log.error('Failed to record device status change', {
        deviceKey: this.deviceKey, error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
