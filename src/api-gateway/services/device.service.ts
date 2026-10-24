import pool from '../../shared/database/connection';
import { ServiceError } from './service-error';

export async function listDevices(tenantId: string) {
  return (await pool.query(
    `SELECT id, device_key, phone_number, label, status, last_connected,
            created_at, updated_at FROM devices WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [tenantId],
  )).rows;
}

export async function getDeviceStatus(tenantId: string, deviceKey: string) {
  const row = (await pool.query(
    `SELECT id, device_key, phone_number, label, status, last_connected,
            qr_code, created_at, updated_at, history_sync_status, history_sync_progress,
            history_sync_completion_explicit,
            history_latest_message_at, history_synced_at FROM devices
     WHERE tenant_id = $1 AND device_key = $2`,
    [tenantId, deviceKey],
  )).rows[0];
  if (!row) throw new ServiceError(404, 'DEVICE_NOT_FOUND', 'Device not found');
  return row;
}

async function updateStatus(tenantId: string, deviceKey: string, status: string) {
  const row = (await pool.query(
    `UPDATE devices SET status = $3 WHERE tenant_id = $1 AND device_key = $2 RETURNING *`,
    [tenantId, deviceKey, status],
  )).rows[0];
  if (!row) throw new ServiceError(404, 'DEVICE_NOT_FOUND', 'Device not found');
  return row;
}

export const pauseDevice = (tenantId: string, deviceKey: string) =>
  updateStatus(tenantId, deviceKey, 'paused');
export const resumeDevice = (tenantId: string, deviceKey: string) =>
  updateStatus(tenantId, deviceKey, 'offline');
