import client from 'prom-client';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: 'wa_api_' });

export const httpRequestsTotal = new client.Counter({
  name: 'wa_api_http_requests_total',
  help: 'Total HTTP requests by method, path pattern, and status code',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [registry],
});

export const httpRequestDurationSeconds = new client.Histogram({
  name: 'wa_api_http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const walletOperationsTotal = new client.Counter({
  name: 'wa_api_wallet_operations_total',
  help: 'Wallet operations by type and outcome',
  labelNames: ['operation', 'outcome'] as const,
  registers: [registry],
});

export const duitkuCallbacksTotal = new client.Counter({
  name: 'wa_api_duitku_callbacks_total',
  help: 'Duitku payment callbacks by result',
  labelNames: ['result'] as const,
  registers: [registry],
});

export const activeWebsockets = new client.Gauge({
  name: 'wa_api_active_websockets',
  help: 'Currently open WebSocket connections',
  registers: [registry],
});

export const messagesQueuedTotal = new client.Counter({
  name: 'wa_api_messages_queued_total',
  help: 'Messages accepted into the send queue',
  labelNames: ['billing_category'] as const,
  registers: [registry],
});

function routePattern(path: string): string {
  if (path === '/health' || path === '/ready' || path === '/metrics') return path;
  if (path.startsWith('/api/v1/')) {
    const segments = path.slice(8).split('/');
    return '/api/v1/' + segments.map((s) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? ':id'
        : /^\d{5,}$/.test(s) ? ':id'
          : s,
    ).join('/');
  }
  if (path.startsWith('/auth/')) return '/auth/*';
  if (path.startsWith('/operator/')) return '/operator/*';
  if (path.startsWith('/admin/')) return '/admin/*';
  if (path.startsWith('/internal/')) return '/internal/*';
  if (path.startsWith('/billing/')) return '/billing/*';
  if (path.startsWith('/public/')) return '/public/*';
  return 'other';
}

export function metricsMiddleware(
  request: import('express').Request,
  response: import('express').Response,
  next: import('express').NextFunction,
): void {
  const start = process.hrtime.bigint();
  response.on('finish', () => {
    const route = routePattern(request.path);
    const labels = { method: request.method, route, status: String(response.statusCode) };
    httpRequestsTotal.inc(labels);
    httpRequestDurationSeconds.observe(labels, Number(process.hrtime.bigint() - start) / 1e9);
  });
  next();
}
