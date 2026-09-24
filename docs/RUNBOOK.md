# Runbook

Operational troubleshooting for WA Gateway. Every entry here is either a
real incident hit during development/testing of this system, or a
documented failure mode of a component that doesn't fail loudly on its own.

## Quick diagnostics

```bash
curl http://localhost:8000/health                          # API Gateway
curl http://localhost:8001/health                           # Device Manager
curl -H "x-api-key: $BOT_API_KEYS" http://localhost:9000/health   # a bot-container (dependency breakdown)
curl http://localhost:9000/metrics                          # Prometheus metrics for that bot
docker compose -f docker/docker-compose.yml ps              # postgres/redis health
```

`GET /health` on a bot-container returns `{ status, dependencies: { db,
redis, whatsapp } }`. `status: "degraded"` with `whatsapp: false` is normal
during reconnect/QR-pending — only `"unhealthy"` (db or redis down) should
page anyone.

## Incidents & known failure modes

### Messages stuck at `status = 'queued'` forever

**Symptom**: a message never progresses past `queued`, no `failed`, no
webhook, nothing in the BullMQ dead-letter queue.

**Cause (fixed 2026-09-24)**: the bot-container queue worker used to throw a
plain error when the WhatsApp socket wasn't connected, without running the
same "final attempt → mark failed → dead-letter → webhook" logic used for
every other failure path. After 3 silent retries, the job just disappeared
into BullMQ's failed-job state with the `messages` row never updated.

**Fix**: all failure paths in `queue.ts` now go through one `failAttempt()`
helper. If you see this symptom again, it means a *new* failure path was
added that bypasses `failAttempt()` — check for anywhere the worker
processor throws directly.

**Verify**: `SELECT status, error_message FROM messages WHERE id = '<id>'`
— should reach `failed` with a populated `error_message` within
`3 × (5s + 10s + 20s)` ≈ 35s of being queued, if the device truly can't send.

### Admin "pause" doesn't actually stop the device from sending

**Symptom**: `POST /api/v1/devices/:key/pause` returns success, `devices.status`
becomes `'paused'`, but messages keep sending.

**Cause (fixed 2026-09-24)**: two independent pause mechanisms exist —
the admin pause endpoint only sets `devices.status`; the anti-ban system's
own automatic health-score pause sets both `status` **and**
`devices.paused_until`. `anti-ban.ts`'s send-gate only checked
`paused_until`, so an admin-initiated pause (no `paused_until`) was
invisible to it.

**Fix**: `canSendMessage()` now denies on `status IN ('paused', 'banned')`
**or** an active `paused_until`, whichever applies.

**Verify**: pause a device via the API, then check that a queued message
for it gets denied with reason `device_paused` (visible in
`wa_bot_anti_ban_denials_total{reason="device_paused"}` or the worker log).

### Rate limits / warm-up caps silently under-count, or content-window checks misfire

**Symptom**: `canSendMessage()` returns a denial reason that doesn't match
reality — e.g. `outside_sending_window` when it's clearly daytime, or the
per-minute limit not triggering after 2 sends within the last minute.

**Cause (fixed 2026-09-24, `src/shared/database/connection.ts`)**: every
timestamp column in this schema is `timestamp without time zone`.
node-postgres reads *and* writes those using the Node **process's local
timezone**, not UTC — even though the Postgres session's own `TimeZone` is
correctly `UTC`. On a host whose local zone isn't UTC (this deployment: WIB,
UTC+7), any comparison between a value read from the database and a
`new Date()` computed in JS is off by the host's UTC offset. A `created_at`
from a message inserted moments ago can appear to be hours away, breaking
every JS-side time-window check (`countMessagesSince` in `anti-ban.ts`
particularly) while anything computed **entirely inside** one SQL statement
(`now() - make_interval(...)`) stays internally consistent and looks fine.

**Fix**: `process.env.TZ = 'UTC'` is set at the top of
`shared/database/connection.ts`, before the pool is created. This makes the
host's "local" time IS UTC, so both pg's read and write paths agree with
raw JS `Date` math.

**If this regresses**: check `date -R` inside the container/host vs
`SELECT now()` from Postgres vs a `new Date().toISOString()` from Node — all
three should show the same instant. If a `timestamp` column value read via
node-pg doesn't match `SELECT created_at FROM ... ` run directly in `psql`
for the same row, `TZ` isn't UTC for that process. Don't patch individual
call sites — fix it at the connection module, once, for every consumer.

### Bot container never shows `qr_code` / stays `pending_qr` forever after pairing

**Symptom**: `GET /api/v1/devices/:key/qr` always 404s (`QR_NOT_AVAILABLE`),
or a device that was clearly scanned and paired stays stuck at `pending_qr`
in the dashboard.

**Cause (fixed 2026-09-24)**: `connection.ts` has an `onQr` callback and
emits proper `ConnectionState` transitions, but `index.ts` never actually
persisted the QR string to `devices.qr_code`, and never synced
`devices.status` from the real connection state at all — Device Manager
sets the initial status once at spawn time and nothing ever updated it
afterward.

**Fix**: `index.ts`'s `onStateChange` now writes `devices.status`,
`devices.qr_code`, and `devices.last_connected` on every transition
(guarded to never overwrite an administrative `paused`/`banned` status).

**Verify**: `SELECT status, qr_code, last_connected FROM devices WHERE
device_key = '<key>'` should track the bot-container's own `GET /status`
response in near real time.

### Device Manager returns 502 / `CONTAINER_START_FAILED` on `POST /admin/device/create`

**Symptom**: device row is created with `status = 'starting'`, then flips to
`'error'`; Device Manager logs `docker run` failing.

**Common cause**: the process running Device Manager doesn't have access to
`/var/run/docker.sock` (wrong group membership, or the socket's group
changed). This is expected — and unavoidable — in any sandboxed shell
without real Docker access; it is **not** expected in a real deployment.

**Check**:
```bash
stat -c '%g %A' /var/run/docker.sock
groups                       # does the Device Manager user have the docker socket's group?
docker version                # does a bare `docker` command work at all here?
```
If `docker version` itself fails with "permission denied", Device Manager
inherits the same failure — this is an environment/permissions problem, not
an application bug. Fix group membership (and re-login the session) before
looking anywhere else.

### `wa-bot:latest` image build not verified

The bot-container Dockerfile (`docker/bot-container.Dockerfile`) has never
been built with a real `docker build` in the environment this project was
developed in (same Docker-socket-access limitation as above). `tsc`/`npm
run build`/`npm test` all pass, and the image's build steps were reviewed
by hand, but a fresh `docker build -f docker/bot-container.Dockerfile -t
wa-bot:latest .` should be run and verified on a machine with real Docker
access before depending on it in any deployment.

## Emergency procedures

### A device is sending obviously wrong/spam content and needs to stop immediately

1. `POST /api/v1/devices/:deviceKey/pause` (tenant's own key) — takes effect
   on the **next** queued job (anti-ban re-checks status per message; an
   in-flight `sendMessage()` call already past that gate will still complete).
2. If it's mid-retry-storm and pausing isn't fast enough, stop the specific
   bot-container: `docker stop wa-bot-<device_key lowercased>` (Device
   Manager names containers `wa-bot-{device_key}`). This kills the queue
   worker outright; queued jobs stay queued until it's restarted.
3. To stop it from ever reconnecting, also revoke pairing from the phone
   itself (WhatsApp → Linked Devices) — a stopped container with valid
   session files will just reconnect and resume on next start.

### Postgres or Redis is down

- Every bot-container's `/health` reports `unhealthy` with the specific
  dependency; API Gateway's own `/health` is currently a bare `{status:
  "ok"}` and does **not** check its DB/Redis dependency the way
  bot-container's does — a Postgres outage will surface as API Gateway
  requests failing with 500s, not as a red `/health`. Don't trust API
  Gateway's `/health` alone during a suspected DB outage; check
  `docker compose ps` / `pg_isready` directly.
- Bot-container queue workers will keep retrying (BullMQ backoff) once
  Redis/Postgres come back — no manual requeue needed for jobs that were
  merely waiting, only for ones that already exhausted their 3 attempts
  and hit the dead-letter queue while the outage was ongoing.

### Rolling back a bad deploy

See `docs/DEPLOYMENT.md` §6 (`./scripts/deploy.sh rollback`). Database
migrations are forward-only — a rollback changes application images, not
schema. If the bad deploy included a migration, fix forward with a new
migration rather than trying to reverse it.

## Escalation

| Area | Owner |
|---|---|
| API Gateway, Device Manager, DB schema/migrations, K8s, deployment scripts, IaC | Codex |
| Bot Container (Baileys), anti-ban system, Dashboard, documentation, testing | Claude |
| Both (shared infra: `src/shared/*`, `docker/docker-compose.yml`) | Either — check `docs/PROJECT_VISION.md` "Team Coordination" first, then whoever touched the file most recently in git history |

There is currently no on-call rotation, paging integration, or external
status page — `docs/PROJECT_VISION.md`'s monitoring section (Alertmanager →
Slack/PagerDuty) is still a checklist item, not wired up. Until it is,
"escalation" means messaging Dzaki directly.
