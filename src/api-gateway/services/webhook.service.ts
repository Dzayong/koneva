import pool from '../../shared/database/connection';
import { ServiceError } from './message.service';

export async function testWebhook(tenantId: string) {
  const tenant = (await pool.query<{ webhook_url: string | null }>(
    'SELECT webhook_url FROM tenants WHERE id = $1', [tenantId],
  )).rows[0];
  if (!tenant?.webhook_url) throw new ServiceError(400, 'WEBHOOK_NOT_SET', 'Webhook URL is not configured');

  const payload = { event: 'webhook.test', timestamp: new Date().toISOString() };
  const response = await fetch(tenant.webhook_url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  });
  await pool.query(
    `INSERT INTO webhook_logs (tenant_id, event_type, payload, response_status, response_body)
     VALUES ($1, 'webhook.test', $2, $3, $4)`,
    [tenantId, payload, response.status, await response.text()],
  );
  return { success: response.ok, status: response.status };
}

export async function getWebhookLogs(tenantId: string, limit = 50, offset = 0) {
  return (await pool.query(
    `SELECT * FROM webhook_logs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [tenantId, limit, offset],
  )).rows;
}
