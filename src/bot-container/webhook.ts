import crypto from 'node:crypto';
import { query } from '../shared/database/connection';
import logger from '../shared/utils/logger';
import { webhookDispatchTotal } from './metrics';
import { withSpan } from './tracing';
import type { QueryFn } from './health-score';

const defaultQueryFn: QueryFn = (text, params) => query(text, params);

const RETRY_DELAYS_MS = [1_000, 5_000, 15_000];

export type WebhookEventType =
  | 'message.sent'
  | 'message.delivered'
  | 'message.read'
  | 'message.received'
  | 'message.failed'
  | 'device.status_changed';

export interface WebhookPayload {
  event: WebhookEventType;
  device_key: string;
  message_id?: string;
  whatsapp_message_id?: string;
  to?: string;
  from?: string;
  chat_jid?: string;
  is_group?: boolean;
  content?: string;
  /** Message payload type when WhatsApp supplies a non-text message. */
  type?: 'text' | 'image' | 'video' | 'audio' | 'document';
  /** Private media ID; fetch through the tenant API using the device API key. */
  media_id?: string;
  direction?: 'inbound' | 'outbound';
  status?: string;
  previous_status?: string;
  reason?: string;
  code?: number;
  timestamp: string;
}

interface TenantWebhookConfig {
  webhookUrl: string;
  webhookSecret: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function computeWebhookSignature(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

export const WEBHOOK_TIMEOUT_MS = 10_000;

/**
 * Headers for one delivery. `X-Webhook-Secret` predates the others and carries the HMAC hex (not the
 * secret itself); it is kept so existing receivers keep working. New receivers should use
 * `X-Webhook-Signature: sha256=<hex>`.
 */
export function webhookHeaders(event: string, body: string, secret: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Webhook-Event': event };
  if (secret) {
    const signature = computeWebhookSignature(body, secret);
    headers['X-Webhook-Secret'] = signature;
    headers['X-Webhook-Signature'] = `sha256=${signature}`;
  }
  return headers;
}

async function getTenantWebhookConfig(
  tenantId: string,
  queryFn: QueryFn,
): Promise<TenantWebhookConfig | undefined> {
  const { rows } = await queryFn(`SELECT webhook_url, webhook_secret FROM tenants WHERE id = $1`, [
    tenantId,
  ]);
  const row = rows[0] as { webhook_url: string | null; webhook_secret: string | null } | undefined;
  if (!row?.webhook_url) {
    return undefined;
  }
  return { webhookUrl: row.webhook_url, webhookSecret: row.webhook_secret };
}

async function logWebhookAttempt(
  tenantId: string,
  payload: WebhookPayload,
  responseStatus: number | undefined,
  responseBody: string | undefined,
  retryCount: number,
  queryFn: QueryFn,
): Promise<void> {
  await queryFn(
    `INSERT INTO webhook_logs (tenant_id, event_type, payload, response_status, response_body, retry_count)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tenantId, payload.event, JSON.stringify(payload), responseStatus ?? null, responseBody ?? null, retryCount],
  );
}

export interface DispatchWebhookOptions {
  queryFn?: QueryFn;
}

export async function dispatchWebhook(
  tenantId: string,
  payload: WebhookPayload,
  options: DispatchWebhookOptions = {},
): Promise<void> {
  await withSpan(
    'webhook.dispatch',
    { tenant_id: tenantId, event: payload.event },
    () => dispatchWebhookBody(tenantId, payload, options),
  );
}

async function dispatchWebhookBody(
  tenantId: string,
  payload: WebhookPayload,
  options: DispatchWebhookOptions,
): Promise<void> {
  const queryFn = options.queryFn ?? defaultQueryFn;
  const config = await getTenantWebhookConfig(tenantId, queryFn);

  if (!config) {
    logger.debug('No webhook URL configured for tenant, skipping dispatch', {
      tenantId,
      event: payload.event,
    });
    return;
  }

  const body = JSON.stringify(payload);
  let lastStatus: number | undefined;
  let lastBody: string | undefined;
  let attempt = 0;

  for (; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const response = await fetch(config.webhookUrl, {
        method: 'POST',
        headers: webhookHeaders(payload.event, body, config.webhookSecret),
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      lastStatus = response.status;
      lastBody = await response.text().catch(() => '');

      if (response.ok) {
        await logWebhookAttempt(tenantId, payload, lastStatus, lastBody, attempt, queryFn);
        webhookDispatchTotal.inc({ event: payload.event, outcome: 'success' });
        logger.info('Webhook dispatched', { tenantId, event: payload.event, attempt, status: lastStatus });
        return;
      }

      logger.warn('Webhook responded with a non-2xx status', {
        tenantId,
        event: payload.event,
        attempt,
        status: lastStatus,
      });
    } catch (err) {
      lastStatus = undefined;
      lastBody = err instanceof Error ? err.message : String(err);
      logger.warn('Webhook dispatch attempt failed', {
        tenantId,
        event: payload.event,
        attempt,
        error: lastBody,
      });
    }

    const retryDelay = RETRY_DELAYS_MS[attempt];
    if (retryDelay !== undefined) {
      await sleep(retryDelay);
    }
  }

  logger.error('Webhook dispatch exhausted all retries', {
    tenantId,
    event: payload.event,
    lastStatus,
  });
  webhookDispatchTotal.inc({ event: payload.event, outcome: 'failure' });
  await logWebhookAttempt(tenantId, payload, lastStatus, lastBody, attempt - 1, queryFn);
}
