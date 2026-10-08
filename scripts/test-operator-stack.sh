#!/usr/bin/env bash
# STACK-local browser tests: real Postgres (disposable container), real operator router, real Next proxy, real cookies.
# No production env file, no Redis/bot/WhatsApp, no payment gateway. Evidence level: STACK-local, never LIVE.
set -euo pipefail
cd "$(dirname "$0")/.."
name="koneva-operator-stack-$$"
harness_pid=""
outbox_dir=$(mktemp -d)
cleanup() {
  [[ -n "$harness_pid" ]] && kill "$harness_pid" >/dev/null 2>&1 || true
  docker rm -f "$name" >/dev/null 2>&1 || true
  rm -rf "$outbox_dir"
}
trap cleanup EXIT
docker run --rm -d --name "$name" --label koneva.purpose=operator-isolated-test \
  -e POSTGRES_PASSWORD=operator_test_only -e POSTGRES_DB=operator_test \
  -p 127.0.0.1::5432 postgres:15-alpine >/dev/null
for _ in {1..30}; do docker exec "$name" pg_isready -U postgres -d operator_test >/dev/null 2>&1 && break; sleep 1; done
binding=$(docker port "$name" 5432/tcp | head -1)
export DATABASE_URL="postgres://postgres:operator_test_only@${binding}/operator_test"
export NODE_ENV=test JWT_SECRET=stack-test-jwt ADMIN_API_KEY=stack-test-admin REDIS_URL=redis://127.0.0.1:1 DOTENV_CONFIG_QUIET=true
export OPERATOR_STACK_HARNESS=1 OPERATOR_ENABLED=true OPERATOR_ALLOWED_ORIGIN=http://localhost:13300
export OPERATOR_COOKIE_NAME=__Host-koneva_op OPERATOR_COOKIE_SECURE=true OPERATOR_INSECURE_DEV_COOKIES=false
export DEVICE_MANAGER_URL=http://127.0.0.1:18092 STACK_MANAGER_PORT=18092 EMAIL_TRANSPORT=dev-outbox DEV_EMAIL_OUTBOX_FILE="$outbox_dir/outbox.jsonl"
# No Gmail variable may reach this run (shared/config loads .env; existing variables, even empty, are never overridden).
export GMAIL_OAUTH_CLIENT_ID= GMAIL_OAUTH_CLIENT_SECRET= GMAIL_OAUTH_REFRESH_TOKEN= GMAIL_SENDER_EMAIL=
export STACK_WEB_PORT=13300 STACK_API_PORT=13310 STACK_CTL_PORT=13311 INTERNAL_API_URL=http://127.0.0.1:13310
node --require ts-node/register scripts/operator-stack-harness.ts &
harness_pid=$!
for _ in {1..60}; do curl -fs http://127.0.0.1:13311/health >/dev/null 2>&1 && break; sleep 1; done
curl -fs http://127.0.0.1:13311/health >/dev/null
cd dashboard
LD_LIBRARY_PATH="${LD_LIBRARY_PATH:-}:/tmp/pwlibs/root/usr/lib/x86_64-linux-gnu" npx playwright test -c playwright.stack.config.ts "$@"
