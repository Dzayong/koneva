/**
 * k6 load test for POST /api/v1/message/send.
 *
 * Simulates 1000 messages/minute (~16.7 req/s) sustained load, per
 * docs/PROJECT_VISION.md's testing strategy. This only measures the API
 * Gateway → Postgres → BullMQ enqueue path — it does not send real
 * WhatsApp messages (the device it targets doesn't need to be paired; a
 * bot-container worker picking the jobs up or not doesn't affect these
 * numbers either way).
 *
 * Install k6: https://k6.io/docs/get-started/installation/
 * (or use the static binary directly, no root needed:
 *  curl -fsSL -o k6.tar.gz \
 *    https://github.com/grafana/k6/releases/download/v0.55.0/k6-v0.55.0-linux-amd64.tar.gz \
 *  && tar xzf k6.tar.gz)
 *
 * Run:
 *   API_URL=http://localhost:8000 \
 *   TENANT_API_KEY=test_api_key_123 \
 *   DEVICE_KEY=WAPI-TEST01 \
 *   k6 run scripts/load/send-message.js
 *
 * The target device does NOT need to be online — /api/v1/message/send
 * itself returns 409 DEVICE_OFFLINE for an offline device, which this
 * script treats as a defined, checked outcome (not a failure) so you can
 * point it at a device that will never actually go online. To load-test
 * the "successfully queued" path specifically, use an online device (or a
 * high tenant quota — quota-exceeded also returns a defined, non-2xx
 * status this script accounts for).
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const API_URL = __ENV.API_URL || 'http://localhost:8000';
const TENANT_API_KEY = __ENV.TENANT_API_KEY || 'test_api_key_123';
const DEVICE_KEY = __ENV.DEVICE_KEY || 'WAPI-TEST01';
const TARGET_RATE = Number(__ENV.TARGET_RATE_PER_MIN || 1000) / 60; // req/s
const DURATION = __ENV.DURATION || '2m';

const queuedTotal = new Counter('messages_queued_total');
const rejectedTotal = new Counter('messages_rejected_total');
const enqueueDuration = new Trend('enqueue_duration_ms', true);

export const options = {
  scenarios: {
    steady_throughput: {
      executor: 'constant-arrival-rate',
      rate: Math.max(1, Math.round(TARGET_RATE)),
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 50,
      maxVUs: 300,
    },
  },
  thresholds: {
    // The enqueue path (validate + insert + BullMQ add) should stay fast
    // even under sustained load; p95 above 500ms means something (DB pool
    // exhaustion, Redis latency) is degrading, not "WhatsApp is slow" —
    // this scenario never touches WhatsApp.
    http_req_duration: ['p(95)<500', 'p(99)<1500'],
    // Only count genuine failures (5xx, timeouts, connection errors) —
    // 409/429 are expected, checked responses, not failures, see below.
    http_req_failed: ['rate<0.01'],
  },
};

export default function sendMessage() {
  const payload = JSON.stringify({
    device_key: DEVICE_KEY,
    to: '6281234567890',
    message: `load test ${__VU}-${__ITER} ${Date.now()}`,
  });

  const res = http.post(`${API_URL}/api/v1/message/send`, payload, {
    headers: { 'Content-Type': 'application/json', apikey: TENANT_API_KEY },
    // A request that never gets a response at all (timeout, connection
    // refused) is a real failure and should count toward http_req_failed;
    // a request that got *any* HTTP response, even 409/429, did not fail
    // at the transport level.
    responseCallback: http.expectedStatuses(202, 400, 401, 404, 409, 429),
  });

  enqueueDuration.add(res.timings.duration);

  const isQueued = res.status === 202;
  const isExpectedRejection = [400, 401, 404, 409, 429].includes(res.status);

  if (isQueued) {
    queuedTotal.add(1);
  } else if (isExpectedRejection) {
    rejectedTotal.add(1);
  }

  check(res, {
    'got a defined response (202 queued, or a checked rejection)': (r) =>
      isQueued || isExpectedRejection,
    'enqueue path responded in < 1s': (r) => r.timings.duration < 1000,
  });

  sleep(0.05);
}

export function handleSummary(data) {
  const total = data.metrics.http_reqs?.values?.count ?? 0;
  const queued = data.metrics.messages_queued_total?.values?.count ?? 0;
  const rejected = data.metrics.messages_rejected_total?.values?.count ?? 0;
  const p95 = data.metrics.http_req_duration?.values?.['p(95)'] ?? 0;
  const p99 = data.metrics.http_req_duration?.values?.['p(99)'] ?? 0;
  const failRate = data.metrics.http_req_failed?.values?.rate ?? 0;

  const summary = [
    '',
    '=== Load test summary: POST /api/v1/message/send ===',
    `Total requests:     ${total}`,
    `  Queued (202):      ${queued}`,
    `  Rejected (checked): ${rejected}`,
    `  Transport failures: ${(failRate * total).toFixed(0)} (${(failRate * 100).toFixed(2)}%)`,
    `Latency p95 / p99:   ${p95.toFixed(1)}ms / ${p99.toFixed(1)}ms`,
    '',
  ].join('\n');

  return {
    stdout: summary,
    'scripts/load/last-summary.json': JSON.stringify(data, null, 2),
  };
}
