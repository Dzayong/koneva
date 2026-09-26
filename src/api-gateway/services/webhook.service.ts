import pool from '../../shared/database/connection';
import { ServiceError } from './service-error';

export async function testWebhook(tenantId: string) {
  const tenant = (await pool.query<{ webhook_url: string | null; webhook_secret: string | null }>(
    'SELECT webhook_url, webhook_secret FROM tenants WHERE id = $1', [tenantId],
  )).rows[0];
  if (!tenant?.webhook_url) throw new ServiceError(400, 'WEBHOOK_NOT_SET', 'Webhook URL is not configured');

  const payload = { event: 'webhook.test', timestamp: new Date().toISOString() };
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (tenant.webhook_secret) {
    const { computeWebhookSignature } = await import('../../bot-container/webhook');
    headers['X-Webhook-Secret'] = computeWebhookSignature(body, tenant.webhook_secret);
  }
  const response = await fetch(tenant.webhook_url, { method: 'POST', headers, body });
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
