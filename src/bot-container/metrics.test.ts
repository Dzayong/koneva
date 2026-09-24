import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  registry,
  messagesSentTotal,
  messagesFailedTotal,
  activeConnections,
  antiBanDenialsTotal,
} from './metrics';

test('registry exposes valid Prometheus exposition text including custom metrics', async () => {
  messagesSentTotal.inc({ device_key: 'WAPI-TEST01', type: 'text' });
  messagesFailedTotal.inc({ device_key: 'WAPI-TEST01', reason: 'not_connected' });
  activeConnections.set({ device_key: 'WAPI-TEST01' }, 1);
  antiBanDenialsTotal.inc({ device_key: 'WAPI-TEST01', reason: 'rate_limit_per_minute' });

  const text = await registry.metrics();
  assert.match(text, /^# HELP wa_bot_messages_sent_total/m);
  assert.match(text, /wa_bot_messages_sent_total\{device_key="WAPI-TEST01",type="text"\} 1/);
  assert.match(text, /wa_bot_messages_failed_total\{device_key="WAPI-TEST01",reason="not_connected"\} 1/);
  assert.match(text, /wa_bot_active_connections\{device_key="WAPI-TEST01"\} 1/);
  assert.match(
    text,
    /wa_bot_anti_ban_denials_total\{device_key="WAPI-TEST01",reason="rate_limit_per_minute"\} 1/,
  );
  // collectDefaultMetrics ran (Node process metrics), confirming the default
  // collector is actually wired to this registry, not just the custom ones.
  assert.match(text, /wa_bot_process_cpu_user_seconds_total/);
});

test('registry.contentType is the Prometheus exposition format header', () => {
  assert.match(registry.contentType, /^text\/plain/);
});
