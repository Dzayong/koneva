#!/usr/bin/env bash
# Synthetic STACK proof for the DOKU webhook path (docs/DOKU_INTEGRATION_SPEC.md):
# real disposable Postgres, real migrations, real billing.service/doku.service code —
# a synthetic DOKU_SHARED_KEY, never a real sandbox credential (none exists yet).
set -euo pipefail
cd "$(dirname "$0")/.."
container="koneva-doku-stack-$$"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run --rm -d --name "$container" --label koneva.purpose=operator-isolated-test \
  -e POSTGRES_PASSWORD=doku_test_only -e POSTGRES_DB=operator_test \
  -p 127.0.0.1::5432 postgres:15-alpine >/dev/null
for _ in $(seq 1 60); do
  count=$(docker logs "$container" 2>&1 | grep -c "ready to accept connections" || true)
  [[ "$count" -ge 2 ]] && break
  sleep 1
done
for _ in $(seq 1 30); do docker exec "$container" pg_isready -U postgres -d operator_test >/dev/null 2>&1 && break; sleep 1; done

export DATABASE_URL="postgres://postgres:doku_test_only@$(docker port "$container" 5432/tcp | head -1)/operator_test"
export NODE_ENV=test
export ADMIN_API_KEY=stack-test-admin JWT_SECRET=stack-test-jwt REDIS_URL=redis://127.0.0.1:1
export DOKU_CLIENT_ID=MCH-SYNTHETIC-TEST DOKU_SHARED_KEY=synthetic-doku-shared-key-not-real
export APP_PUBLIC_URL=http://localhost:3000
export DOTENV_CONFIG_QUIET=true GMAIL_OAUTH_CLIENT_ID= GMAIL_OAUTH_CLIENT_SECRET= GMAIL_OAUTH_REFRESH_TOKEN= GMAIL_SENDER_EMAIL=

for f in migrations/*.sql; do
  docker exec -e PGPASSWORD=doku_test_only -i "$container" psql -U postgres -d operator_test -v ON_ERROR_STOP=1 < "$f" >/dev/null
done

node --require ts-node/register --test src/api-gateway/doku-sandbox.stack.ts
