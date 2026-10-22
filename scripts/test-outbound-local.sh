#!/usr/bin/env bash
# Outbound-control tests: real PostgreSQL + real Redis (disposable containers) and a FAKE WhatsApp transport that only records calls.
# No bot container, no Baileys socket, no WhatsApp number, no email (pinned off), no production data.
set -euo pipefail
cd "$(dirname "$0")/.."
suffix="$$"
pg="koneva-outbound-pg-$suffix"; redis="koneva-outbound-redis-$suffix"
cleanup() {
  docker rm -f "$pg" "$redis" >/dev/null 2>&1 || true
  echo "cleanup: temporary containers left for this run: $(docker ps -a --filter "name=koneva-outbound-.*-$suffix" --format '{{.Names}}' | wc -l)"
}
trap cleanup EXIT
docker run --rm -d --name "$pg" --label koneva.purpose=operator-isolated-test -e POSTGRES_PASSWORD=outbound_test_only -e POSTGRES_DB=operator_test -p 127.0.0.1::5432 postgres:15-alpine >/dev/null
docker run --rm -d --name "$redis" --label koneva.purpose=operator-isolated-test -p 127.0.0.1::6379 redis:7-alpine >/dev/null
for _ in {1..30}; do docker exec "$pg" pg_isready -U postgres -d operator_test >/dev/null 2>&1 && break; sleep 1; done
for _ in {1..30}; do docker exec "$redis" redis-cli ping >/dev/null 2>&1 && break; sleep 1; done
export DATABASE_URL="postgres://postgres:outbound_test_only@$(docker port "$pg" 5432/tcp | head -1)/operator_test"
export REDIS_URL="redis://$(docker port "$redis" 6379/tcp | head -1)"
export NODE_ENV=test JWT_SECRET=outbound-test-jwt ADMIN_API_KEY=outbound-test-admin DOTENV_CONFIG_QUIET=true TS_NODE_TRANSPILE_ONLY=true
export DEVICE_MANAGER_URL=http://127.0.0.1:1 OUTBOUND_GUARD_TEST=1
export OUTBOUND_SUSTAINED_TEST="${OUTBOUND_SUSTAINED_TEST:-0}"
# Tests never send email (see the note in test-operator-local.sh).
export EMAIL_TRANSPORT=none GMAIL_OAUTH_CLIENT_ID= GMAIL_OAUTH_CLIENT_SECRET= GMAIL_OAUTH_REFRESH_TOKEN= GMAIL_SENDER_EMAIL= DEV_EMAIL_OUTBOX_FILE=
./node_modules/.bin/tsc --noEmit
node --require ts-node/register scripts/migrate.ts >/dev/null
node --require ts-node/register --test --test-force-exit --test-concurrency=1 src/bot-container/outbound-guards.test.ts
