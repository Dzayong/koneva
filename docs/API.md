# API Reference

Two APIs exist. Tenants and admin tooling talk to the **API Gateway**; only
Device Manager and API Gateway talk to a **Bot Container** directly.

## API Gateway (public)

`src/api-gateway`, port `8000`. Full OpenAPI spec: [`openapi.yaml`](./openapi.yaml)
— every endpoint and response shape in it was verified against a running
instance (`scripts/integration-test.ts`), not written from a spec alone.

**Auth**: tenant routes (`/api/v1/*`) take an `apikey` header (the tenant's
own key); admin routes (`/admin/*`) take an `x-admin-key` header
(`ADMIN_API_KEY`) — these are two different secrets, don't mix them up.

**Response envelope**: `{ success, data }` everywhere, *except*
`GET /api/v1/messages` which returns `{ data, pagination }` directly — no
`success` field. That inconsistency is real, kept faithful rather than
smoothed over.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/v1/message/send` | tenant | 202 = queued, not delivered |
| GET | `/api/v1/messages` | tenant | `{data, pagination}`, no date-range filter |
| GET | `/api/v1/messages/:id` | tenant | includes `status_history` |
| GET | `/api/v1/devices` | tenant | |
| GET | `/api/v1/devices/:key` | tenant | includes `qr_code` |
| GET | `/api/v1/devices/:key/qr` | tenant | 409 if not `pending_qr` |
| POST | `/api/v1/devices/:key/pause` | tenant | sets `status='paused'`, actually blocks sending |
| POST | `/api/v1/devices/:key/resume` | tenant | sets `status='offline'`, not `'online'` |
| POST | `/admin/tenant/create` | admin | returns the new `api_key` |
| POST | `/admin/device/create` | admin | proxies to Device Manager's `docker run` |
| GET | `/admin/tenants` | admin | with device/message counts |
| GET | `/admin/devices` | admin | optional `?status=` filter |
| GET | `/admin/stats` | admin | |

No tenant-scoped device creation, tenant self-info, or webhook
config exists yet — see `docs/ARCHITECTURE.md` "Known gaps".

## Bot Container (internal)

Each running `bot-container` process exposes a small HTTP API on
`BOT_CONTAINER_PORT` (default `9000`). One instance == one WhatsApp device.
This is an **internal** API: Device Manager and API Gateway are its callers,
not end users. Its own queue worker is what actually drains the messages
API Gateway enqueues — this section is about the HTTP surface only.

## Authentication

Every route except `GET /health` and `GET /ready` requires an API key, sent
as either header:

```
x-api-key: <key>
Authorization: Bearer <key>
```

Valid keys come from `BOT_API_KEYS` (comma-separated, for zero-downtime
rotation — add the new key, redeploy, remove the old one) and fall back to
`ADMIN_API_KEY` if `BOT_API_KEYS` is unset. An invalid or missing key returns:

```json
{ "error": { "code": "unauthorized", "message": "Invalid or missing API key" } }
```

## Error format

Every error response has this shape:

```json
{ "error": { "code": "validation_error", "message": "...", "details": { } } }
```

| Status | code | When |
|---|---|---|
| 400 | `validation_error` | Bad request body (missing/invalid fields, malformed JSON) |
| 401 | `unauthorized` | Missing or invalid API key |
| 404 | `not_found` | Unknown route |
| 429 | `rate_limited` | Too many `POST /send` calls (60/min) |
| 500 | `internal_error` | Unhandled server error (logged with request context) |

## Endpoints

### `GET /health`

No auth required. For liveness probes — checks Postgres/Redis/WhatsApp.

```json
{
  "status": "degraded",
  "device_key": "WAPI-TEST01",
  "uptime": 123.4,
  "dependencies": { "db": true, "redis": true, "whatsapp": false },
  "detail": { "whatsapp": "connection status is 'qr_pending'" }
}
```

`status`: `healthy` (200) | `degraded` (200 — WhatsApp not connected, e.g.
mid-QR/reconnect, this is normal) | `unhealthy` (503 — Postgres or Redis
unreachable, this is not normal). `detail` is only present for failing
dependencies.

### `GET /ready`

No auth required. For readiness probes — returns `503` until the WhatsApp
socket is actually `online`. Use this, not `/health`, to gate traffic —
`/health` intentionally stays `200` while merely disconnected.

```json
{ "ready": true, "status": "online" }
```

### `GET /metrics`

No auth required (same convention as `/health`/`/ready` — protect at the
network layer, e.g. don't expose the port publicly). Prometheus exposition
format. Key series: `wa_bot_messages_sent_total`,
`wa_bot_messages_failed_total{reason}`, `wa_bot_message_duration_seconds`,
`wa_bot_active_connections`, `wa_bot_anti_ban_denials_total{reason}`,
`wa_bot_webhook_dispatch_total{event,outcome}`,
`wa_bot_queue_job_duration_seconds`, plus prom-client's default Node
process/event-loop metrics under the `wa_bot_` prefix.

### `GET /status`

Full device status: connection state + the device's row from the database
(health score, warm-up, pause state). The device row is served from a 3s
Redis cache — display-only, never used for anti-ban decisions.

```json
{
  "device_key": "WAPI-TEST01",
  "connection": {
    "status": "online",
    "reconnectAttempt": 0,
    "lastConnectedAt": "2026-09-24T10:00:00.000Z",
    "lastDisconnectReason": null
  },
  "hasSession": true,
  "device": {
    "id": "3fb1ebdb-...",
    "tenantId": "8fca6485-...",
    "status": "online",
    "healthScore": 72,
    "warmupCompletedAt": null,
    "pausedUntil": null
  },
  "uptimeSeconds": 3600.2
}
```

### `POST /send`

Queues a message (BullMQ) for this device. Actual sending is gated by
`anti-ban.ts` (rate limits, warm-up caps, sending window, content rules) —
`202` means "accepted into the queue", not "delivered". Rate-limited to 60
requests/minute per bot-container.

Request:

```json
{ "to": "6281234567890", "type": "text", "content": "Halo Budi" }
```

- `to`: digits only, 8–15 characters (country code + number, no `+` or `@s.whatsapp.net`)
- `type`: `text` (default) | `image` | `video` | `audio` | `document` — for
  non-text types, `content` is the media URL (there's no separate
  caption field in the schema yet)
- `content`: 1–4096 characters

Response (`202`):

```json
{ "messageId": "9380ccc2-9098-...", "status": "queued" }
```

Poll `GET /status` or watch for the `message.sent` / `message.delivered` /
`message.read` / `message.failed` webhook events (see below) for the outcome.

## Webhook events

Dispatched to the tenant's `webhook_url` (from the `tenants` table), signed
with HMAC-SHA256 over the raw JSON body using `webhook_secret` as the key, in
an `X-Webhook-Secret` header. Retried at 1s / 5s / 15s; every attempt
(success or final failure) is logged to `webhook_logs`.

```json
{
  "event": "message.delivered",
  "device_key": "WAPI-XXX",
  "message_id": "uuid",
  "whatsapp_message_id": "wamid.xxx",
  "to": "6281234567890",
  "status": "delivered",
  "timestamp": "2026-09-24T20:30:00Z"
}
```

Events: `message.sent`, `message.delivered`, `message.read`,
`message.failed`, `device.status_changed` (the last one is defined in the
type but not yet emitted anywhere — see `docs/ARCHITECTURE.md` gaps).
