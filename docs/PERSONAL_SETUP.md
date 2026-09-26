# Personal deployment

This is an isolated single-host Docker deployment: PostgreSQL, persistent Redis,
API Gateway, Device Manager, Next.js dashboard, and dynamic WhatsApp bots. The
optional nginx profile adds a public reverse proxy. Existing dev/Kubernetes
services are not stopped or reused.

## Start

Requirements: Linux host with Docker Engine, Docker Compose v2 supporting
`up --wait`, Bash, OpenSSL, flock, gzip, tar, and Make. Run as the same non-root
user with Docker access each time. Allow several GB of disk and memory for builds.
The Docker socket grants Device Manager host-level Docker control: this setup is
for a trusted personal machine, not an untrusted shared server.

```bash
cd /path/to/wa-gateway
make start
make ps
make monitor
```

First start creates `.env.personal` (mode 600) with random 64-character secrets.
It does not modify `.env`. To configure manually, copy `.env.personal.example`
to `.env.personal` and fill all four secret fields with `openssl rand -hex 32`.
Use `PERSONAL_ENV_FILE=/absolute/path/to/env make start` for another config.
The env file is trusted shell configuration; quote values containing spaces.

Default URLs/ports intentionally avoid the running development stack:

| Service | Address |
|---|---|
| Dashboard | http://localhost:13000 |
| API Gateway | http://localhost:18000 |
| Device Manager | http://localhost:18001 (local only) |
| PostgreSQL | 127.0.0.1:55432 |
| Redis | 127.0.0.1:56379 |

Change `API_PORT`, `MANAGER_PORT`, `DASHBOARD_PORT`, `DB_PORT`, `REDIS_PORT` if
needed. App ports also bind to loopback by default. For a remote personal server
use an SSH tunnel, or nginx with TLS. Never expose the database or manager.
No services use fixed container names, so the old development project can coexist.

Start builds the bot image before provisioning can occur, waits for database and
Redis health, runs compiled migrations, then waits for application readiness.
The dashboard sends browser requests to its own origin and proxies tenant API
requests internally; no public API URL or browser CORS setup is needed.

## First tenant and WhatsApp pairing

Create one tenant via the loopback admin API. The response includes your tenant
API key; keep it private and use it on the dashboard login page. `ADMIN_API_KEY`
is never the dashboard tenant key.

```bash
set -a; source .env.personal; set +a
curl --fail-with-body -sS "http://127.0.0.1:${API_PORT}/admin/tenant/create" \
  -H "x-admin-key: ${ADMIN_API_KEY}" -H 'content-type: application/json' \
  -d '{"name":"Personal","email":"you@example.com"}'
```

Then add a device and scan its QR from WhatsApp Linked Devices. The image has a
health check; an unpaired device can remain degraded but alive until scanned.
Dynamic bots are attached to the same network and labelled by that network.
Sessions use the identical absolute host path inside Device Manager so the Docker
daemon mounts the correct directory. The manager and bot run as the host user's
UID/GID; the manager also receives the socket's group ID.

## Stop, update, persistence

`make stop` stops only this stack and its labelled bots. It keeps containers,
network, named volumes, and session files. `make start` resumes them. Database
and Redis data survive container recreation. Never use `down -v` unless you
intend to destroy those databases.

`make update` backs up first, builds the current checkout, migrates before new
services start, and recreates running personal bots from the new image while
retaining sessions. Expect a short interruption and reconnect. For a clean Git
checkout only, `bash scripts/update-personal.sh --pull` adds a fast-forward pull.
There is no implicit `git pull`, hard reset, or deletion of local changes.
Do not rotate database passwords by editing env alone: change PostgreSQL's role
password first and coordinate app credentials. Do not run multiple update jobs.

## Backup and restore

```bash
make backup
make backup-cron   # Prints a line to add with crontab -e
```

Backup briefly stops active application writers and bots, then saves a PostgreSQL
SQL dump, completed Redis RDB snapshot, session tarball, env file and revision.
Only previously running containers are resumed, including on errors. Complete
archives have SHA256SUMS; failed runs retain `.incomplete-*` files for diagnosis.
Default retention is seven days. Scheduling is opt-in: `make backup-cron` prints
the configured schedule; it does not silently overwrite your crontab. Cron uses
the host timezone. Backups contain API keys and WhatsApp credentials: copy them
to private off-host storage and encrypt that storage. Logs rotate at 10 MB × 3.

Restore on a separate isolated installation first, matching DB_USER/DB_NAME and
image revision. Verify `(cd <backup> && sha256sum -c SHA256SUMS)`. Stop writers
and bots before importing. PostgreSQL restore into an **empty** database:

```bash
gzip -dc /absolute/backup/postgres.sql.gz | \
  bash scripts/personal-compose.sh exec -T postgres sh -c \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Restore sessions with `tar -xzf <backup>/sessions.tar.gz -C <dedicated-session-dir>`
using the same UID/GID. For Redis, use a **new empty Redis volume**, put the RDB
at `/data/dump.rdb` and boot Redis with AOF temporarily disabled, then enable AOF
using `CONFIG SET appendonly yes` before returning to the normal configuration.
An existing Redis 7 appendonly directory takes precedence over an RDB: do not
overlay the snapshot onto live AOF files. Queue restoration may redeliver jobs;
verify message state before reconnecting bots. No destructive automated restore
is provided. Keep the original volumes until the restored system is verified.

## Optional domain and TLS

Point DOMAIN's DNS to this host, set EMAIL and `COMPOSE_PROFILES=with-nginx` in
`.env.personal`, expose ports 80/443, and run `make start`. nginx first serves HTTP
and the ACME challenge; it never redirects to a nonexistent HTTPS listener.

```bash
make ssl        # Requests certificate and enables HTTPS + HTTP redirect
make renew-ssl  # Renews if due, tests nginx config and reloads
```

Certificate issuance contacts Let's Encrypt and accepts its subscriber agreement.
Run only for a domain you control. Certbot is a one-shot optional profile, not a
crash-looping service. nginx mounts the same `/etc/letsencrypt` tree as Certbot.
Add `make renew-ssl` to cron twice daily with an absolute repo directory, the
correct env file, and Docker access. `make monitor` reports container health and
returns nonzero on failure; it does not send external notifications.

## Troubleshooting

- `make logs` / `make ps`: inspect health and failures.
- Address in use: change the corresponding host port, leave service ports fixed.
- Docker permission denied: grant the invoking user Docker access and re-login.
- `make monitor` exits nonzero: inspect `logs --tail=100 <service>`; health is more
  than an open TCP port. Application health checks test dependencies.
- Sessions permission denied: use the same user and an owned dedicated directory.
- Failed update: original backups remain; restore data with the matching code
  revision. Schema rollback is not automatic.

Operational references: [Compose readiness ordering](https://docs.docker.com/compose/how-tos/startup-order/),
[BullMQ production persistence/noeviction](https://docs.bullmq.io/guide/going-to-production).
