import client from 'prom-client';

// One registry per bot-container process — each device is a separate
// container in production, so there's no cross-device aggregation to do
// here; Prometheus does that at scrape time via the `device_key` label.
export const registry = new client.Registry();

client.collectDefaultMetrics({ register: registry, prefix: 'wa_bot_' });

export const messagesSentTotal = new client.Counter({
  name: 'wa_bot_messages_sent_total',
  help: 'Messages successfully handed to Baileys for delivery',
  labelNames: ['device_key', 'type'] as const,
  registers: [registry],
});

export const messagesFailedTotal = new client.Counter({
  name: 'wa_bot_messages_failed_total',
  help: 'Messages that ended in a terminal failed state',
  labelNames: ['device_key', 'reason'] as const,
  registers: [registry],
});

export const messageDurationSeconds = new client.Histogram({
  name: 'wa_bot_message_duration_seconds',
  help: 'Time from a queue job starting to it reaching a terminal state (sent or failed)',
  labelNames: ['device_key', 'outcome'] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120],
  registers: [registry],
});

export const activeConnections = new client.Gauge({
  name: 'wa_bot_active_connections',
  help: '1 if this device currently has an online WhatsApp socket, else 0',
  labelNames: ['device_key'] as const,
  registers: [registry],
});

export const antiBanDenialsTotal = new client.Counter({
  name: 'wa_bot_anti_ban_denials_total',
  help: 'Messages denied by the anti-ban gate, by reason',
  labelNames: ['device_key', 'reason'] as const,
  registers: [registry],
});

export const webhookDispatchTotal = new client.Counter({
  name: 'wa_bot_webhook_dispatch_total',
  help: 'Webhook delivery attempts, by outcome',
  labelNames: ['event', 'outcome'] as const,
  registers: [registry],
});

export const queueJobDurationSeconds = new client.Histogram({
  name: 'wa_bot_queue_job_duration_seconds',
  help: 'Wall-clock time BullMQ spent on one job attempt (anti-ban + send)',
  labelNames: ['device_key'] as const,
  buckets: [0.05, 0.1, 0.5, 1, 5, 15, 30, 60],
  registers: [registry],
});
