#!/usr/bin/env bash
# Black-box tests of the REAL entrypoint (src/api-gateway/index.ts) as a child process, against a disposable PostgreSQL and
# a disposable Redis. No bot, no device manager, no external network, no production env file, no payment gateway.
set -euo pipefail
cd "$(dirname "$0")/.."
suffix="$$"
pg="koneva-operator-entry-pg-$suffix"; redis="koneva-operator-entry-redis-$suffix"
cleanup() {
  docker rm -f "$pg" "$redis" >/dev/null 2>&1 || true
  left=$(docker ps -a --filter "name=koneva-operator-entry-.*-$suffix" --format '{{.Names}}' | wc -l)
  echo "cleanup: temporary containers left for this run: $left"
}
trap cleanup EXIT
docker run --rm -d --name "$pg" --label koneva.purpose=operator-isolated-test -e POSTGRES_PASSWORD=operator_test_only -e POSTGRES_DB=operator_test -p 127.0.0.1::5432 postgres:15-alpine >/dev/null
docker run --rm -d --name "$redis" --label koneva.purpose=operator-isolated-test -p 127.0.0.1::6379 redis:7-alpine >/dev/null
for _ in {1..30}; do docker exec "$pg" pg_isready -U postgres -d operator_test >/dev/null 2>&1 && break; sleep 1; done
for _ in {1..30}; do docker exec "$redis" redis-cli ping >/dev/null 2>&1 && break; sleep 1; done
export DATABASE_URL="postgres://postgres:operator_test_only@$(docker port "$pg" 5432/tcp | head -1)/operator_test"
export REDIS_URL="redis://$(docker port "$redis" 6379/tcp | head -1)"
# Tests never send email. EMAIL_TRANSPORT and every Gmail variable are set explicitly, because shared/config loads .env
# (dotenv does not override variables that already exist, not even empty ones). Individual tests switch to the file outbox themselves.
export EMAIL_TRANSPORT=none GMAIL_OAUTH_CLIENT_ID= GMAIL_OAUTH_CLIENT_SECRET= GMAIL_OAUTH_REFRESH_TOKEN= GMAIL_SENDER_EMAIL= DEV_EMAIL_OUTBOX_FILE=
export NODE_ENV=test JWT_SECRET=entry-test-jwt ADMIN_API_KEY=entry-test-admin DOTENV_CONFIG_QUIET=true
export DEVICE_MANAGER_URL=http://127.0.0.1:1 OPERATOR_ENTRY_TEST=1 OPERATOR_STACK_TEST=1 TS_NODE_TRANSPILE_ONLY=true
OPERATOR_MFA_ENC_KEY=$(head -c 32 /dev/urandom | base64); export OPERATOR_MFA_ENC_KEY
./node_modules/.bin/tsc --noEmit
node --require ts-node/register scripts/migrate.ts >/dev/null   # the repository's own migration runner
node --require ts-node/register --test --test-concurrency=1 src/api-gateway/operator-entry.test.ts
