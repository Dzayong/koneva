/**
 * Must be imported before any other module in the entrypoint (index.ts) —
 * OpenTelemetry's auto-instrumentation patches `require()` for http/pg/
 * ioredis/express, so it only sees modules that get required *after* this
 * file runs. This is a side-effect import: `import './tracing'` first,
 * nothing else.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { trace, type Span, SpanStatusCode } from '@opentelemetry/api';

const OTLP_ENDPOINT = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
const BOT_ID = process.env['BOT_ID'] ?? 'unknown';
const TRACING_ENABLED = process.env['OTEL_TRACING_ENABLED'] !== 'false';

let sdk: NodeSDK | undefined;

if (TRACING_ENABLED) {
  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'wa-bot-container',
      [ATTR_SERVICE_VERSION]: '1.0.0',
      'device.key': BOT_ID,
    }),
    // No collector configured: OTLPTraceExporter still works, it just logs
    // connection errors per export attempt (async, doesn't throw into
    // request handling) — set OTEL_EXPORTER_OTLP_ENDPOINT to silence that
    // and actually see traces in Jaeger/Tempo/etc.
    traceExporter: new OTLPTraceExporter(
      OTLP_ENDPOINT ? { url: `${OTLP_ENDPOINT}/v1/traces` } : {},
    ),
    instrumentations: [
      new HttpInstrumentation(),
      new ExpressInstrumentation(),
      new PgInstrumentation(),
      new IORedisInstrumentation(),
    ],
  });

  try {
    sdk.start();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to start OpenTelemetry SDK, continuing without tracing', err);
    sdk = undefined;
  }

  process.on('SIGTERM', () => void sdk?.shutdown());
  process.on('SIGINT', () => void sdk?.shutdown());
}

const tracer = trace.getTracer('wa-bot-container');

/**
 * Wraps an async operation in a span, recording the error and marking the
 * span as failed if it throws — for the three things the brief calls out:
 * message send, webhook dispatch, DB queries (DB queries also get spans
 * for free from PgInstrumentation; this is for the higher-level operations
 * around them: queue job processing and webhook delivery attempts).
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    for (const [key, value] of Object.entries(attributes)) {
      span.setAttribute(key, value);
    }
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      span.end();
    }
  });
}

export async function shutdownTracing(): Promise<void> {
  await sdk?.shutdown();
}
