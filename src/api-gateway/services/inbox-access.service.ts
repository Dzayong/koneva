import pool from '../../shared/database/connection';
import { ServiceError } from './service-error';

/** Read current grants on every request so revocation does not wait for token expiry. */
export async function assertCsInboxAccess(tenantId: string, userId: string, resource: 'device' | 'message' | 'media', id: string): Promise<void> {
  const target = resource === 'device' ? 'd.device_key=$3' : resource === 'message'
    ? 'EXISTS (SELECT 1 FROM messages x WHERE x.id::text=$3 AND x.tenant_id=$1 AND x.device_id=d.id)'
    : 'EXISTS (SELECT 1 FROM media_objects x WHERE x.id::text=$3 AND x.tenant_id=$1 AND x.device_id=d.id)';
  const result = await pool.query(`SELECT d.id FROM devices d JOIN memberships m ON m.tenant_id=d.tenant_id
    WHERE d.tenant_id=$1 AND m.user_id=$2 AND m.role='cs' AND d.id=ANY(m.device_ids)
      AND d.status<>'deleted' AND ${target}`, [tenantId, userId, id]);
  if (!result.rows.length) throw new ServiceError(403, 'DEVICE_ACCESS_DENIED', 'Anda tidak memiliki akses ke device ini. Hubungi Owner workspace.');
}
