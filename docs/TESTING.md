# Backend Integration Testing

The integration runner exercises the API Gateway, Device Manager, BullMQ worker,
PostgreSQL state/history, Redis queues, webhook delivery, and anti-ban rules. It
uses real local infrastructure. Only boundaries that cannot be automated safely
are replaced: the Docker/Kubernetes control plane and a paired WhatsApp socket.

## Prerequisites

- Node.js dependencies installed with `npm install`
- Docker with Compose
- `.env` configured (the defaults in `.env.example` match Docker Compose)
- migrations applied with `npm run migrate`
- ports 8091, 8092, and 8191 available for isolated test services

The runner starts its own API Gateway and in-process Device Manager, so do not
start `npm run dev`, `npm run dev:manager`, or `npm run dev:bot` for this test.

## Run

```bash
cd docker
docker compose up -d
cd ..
npm run migrate
npm run build
npm test
npx ts-node scripts/integration-test.ts
```

To choose the JSON report destination:

```bash
INTEGRATION_REPORT_PATH=/tmp/wa-integration.json npx ts-node scripts/integration-test.ts
```

The default report is `reports/integration-test-report.json`. The runner uses a
unique suffix for tenants/devices, removes database fixtures, closes queue
workers/connections, and exits non-zero if any step fails. A skipped step is
reported explicitly and does not count as a pass.

## Expected outcomes

| Scenario | Expected result |
|---|---|
| Message flow | HTTP 202; Redis job exists; worker sends via the WhatsApp adapter; history is `queued → sent → delivered`; signed sent/delivered webhooks are received and logged |
| Device lifecycle | Device Manager provisions a mock StatefulSet; DB reaches `pending_qr`; QR is readable; mocked scan reaches `online`; pause/resume work; delete removes the workload and marks the row offline |
| Error handling | Invalid key 401; quota 429; offline device 503; invalid payload 400; failed webhook retries; unavailable DB makes `/ready` return 503 while `/health` stays 200 |
| Anti-ban | Day-one warm-up cap is active; per-minute limit denies; spam is rejected; health score is persisted from delivery history |

The mock WhatsApp adapter is deliberate: it tests the same BullMQ processor and
receipt listener used in production but avoids sending a real message. A staging
smoke test with a paired disposable WhatsApp number is still recommended before
release.

## Troubleshooting

- **Database/Redis connection refused:** run `docker compose ps` in `docker/`
  and wait for both health checks; verify `DATABASE_URL` and `REDIS_URL`.
- **Missing relation or column:** run `npm run migrate`; the status-history
  trigger is required for the transition assertion.
- **Port already in use:** stop local dev services or identify the process using
  8091, 8092, or 8191.
- **Test stalls after unit results:** wait for Node's test workers to finish;
  the complete suite currently includes webhook retry/timer coverage.
- **Webhook assertion fails:** confirm localhost traffic is allowed and inspect
  `webhook_logs` for response status/body.
- **Dirty fixtures after interruption:** test rows use names/device keys containing
  `itest-` and the printed run id; remove only that run's rows after confirming
  no integration process is still active.
