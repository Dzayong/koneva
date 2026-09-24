# WA Gateway

Multi-tenant WhatsApp messaging gateway. A tenant registers, gets WhatsApp
devices provisioned as isolated containers, and sends/receives messages
through a REST API with webhook delivery notifications.

## Services

| Service | Path | Status | Purpose |
|---|---|---|---|
| API Gateway | `src/api-gateway` | in progress | Public REST API (`/api/v1/...`), tenant auth, admin routes |
| Device Manager | `src/device-manager` | in progress | Spawns/manages one `wa-bot` container per WhatsApp device |
| Bot Container | `src/bot-container` | done | One process per device: WhatsApp connection (Baileys), anti-ban, message queue, webhooks |

Each bot container owns exactly one WhatsApp session. Device Manager starts
one Docker container per device (image `wa-bot:latest`, built from
[`docker/bot-container.Dockerfile`](docker/bot-container.Dockerfile)) and the
API Gateway is the only thing tenants talk to directly.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how the pieces fit
together, [`docs/API.md`](docs/API.md) for the bot-container's own HTTP
surface, and [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for running it.

## Quick start (bot-container only)

```bash
cp .env.example .env
npm install
docker compose -f docker/docker-compose.yml up -d --wait   # postgres + redis
npm run migrate
npm run seed                                                # creates a test tenant + 2 devices
BOT_ID=WAPI-TEST01 npm run dev:bot                           # scan the QR it prints
```

Once connected:

```bash
curl -H "x-api-key: $ADMIN_API_KEY" http://localhost:9000/status
curl -X POST http://localhost:9000/send \
  -H "x-api-key: $ADMIN_API_KEY" -H "Content-Type: application/json" \
  -d '{"to":"6281234567890","content":"Halo!"}'
```

## Development

```bash
npm run build   # tsc -> dist/
npm test        # node:test, no external test runner
npm run migrate # apply migrations/*.sql (tracked in _migrations, idempotent)
```

Tests use Node's built-in test runner (`node --test`) against `*.test.ts`
files colocated with the code they cover — no Jest/Mocha dependency.

## Stack

Node.js + TypeScript (strict, `exactOptionalPropertyTypes`), Express, `pg`,
ioredis, BullMQ, Baileys (`@whiskeysockets/baileys`), Winston, Zod, PostgreSQL,
Redis, Docker.
