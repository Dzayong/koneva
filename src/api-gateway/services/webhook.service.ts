import crypto from 'node:crypto';
import pool from '../../shared/database/connection';
import { webhookHeaders, WEBHOOK_TIMEOUT_MS } from '../../bot-container/webhook';
import { ServiceError } from './service-error';

export async function getWebhookSettings(tenantId: string) {
  const row = (await pool.query<{ webhook_url: string | null; webhook_secret: string | null }>(
    'SELECT webhook_url, webhook_secret FROM tenants WHERE id = $1', [tenantId],
  )).rows[0];
  return {
    url: row?.webhook_url ?? null,
    secret_set: Boolean(row?.webhook_secret),
    // Enough to recognise which secret is in use, never enough to sign with.
    secret_hint: row?.webhook_secret ? row.webhook_secret.slice(-4) : null,
  };
}

/** The new secret is returned once; receivers must be updated before the next delivery. */
export async function rotateWebhookSecret(tenantId: string): Promise<string> {
  const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`;
  await pool.query('UPDATE tenants SET webhook_secret = $1, updated_at = NOW() WHERE id = $2', [secret, tenantId]);
  return secret;
}

export async function testWebhook(tenantId: string) {
  const tenant = (await pool.query<{ webhook_url: string | null; webhook_secret: string | null }>(
    'SELECT webhook_url, webhook_secret FROM tenants WHERE id = $1', [tenantId],
  )).rows[0];
  if (!tenant?.webhook_url) throw new ServiceError(400, 'WEBHOOK_NOT_SET', 'Webhook URL is not configured');

  const payload = { event: 'webhook.test', timestamp: new Date().toISOString() };
  const body = JSON.stringify(payload);
  const started = Date.now();
  let status: number | null = null;
  let detail = '';
  try {
    const response = await fetch(tenant.webhook_url, {
      method: 'POST',
      headers: webhookHeaders(payload.event, body, tenant.webhook_secret),
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    status = response.status;
    detail = (await response.text().catch(() => '')).slice(0, 300);
  } catch (error) {
    detail = error instanceof Error && error.name === 'TimeoutError'
      ? `Tidak ada jawaban dalam ${WEBHOOK_TIMEOUT_MS / 1000} detik`
      : 'Server tujuan tidak bisa dihubungi';
  }
  await pool.query(
    `INSERT INTO webhook_logs (tenant_id, event_type, payload, response_status, response_body)
     VALUES ($1, 'webhook.test', $2, $3, $4)`,
    [tenantId, payload, status, detail],
  );
  return { success: status !== null && status >= 200 && status < 300, status, detail, duration_ms: Date.now() - started };
}

export async function getWebhookLogs(tenantId: string, limit = 20) {
  return (await pool.query(
    `SELECT id, event_type, response_status, retry_count, LEFT(response_body, 200) AS response_body, created_at
     FROM webhook_logs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [tenantId, Math.min(Math.max(limit, 1), 100)],
  )).rows;
}
