#!/usr/bin/env bash
# Synthetic STACK proof for Duitku POP callback and PAYG wallet integration. Never uses real secrets
# and never calls Duitku; the database is disposable and bound to localhost only.
set -euo pipefail
cd "$(dirname "$0")/.."
container="koneva-duitku-stack-$$"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run --rm -d --name "$container" --label koneva.purpose=operator-isolated-test \
  -e POSTGRES_PASSWORD=duitku_test_only -e POSTGRES_DB=operator_test \
  -p 127.0.0.1::5432 postgres:15-alpine >/dev/null
for _ in $(seq 1 60); do
  count=$(docker logs "$container" 2>&1 | grep -c "ready to accept connections" || true)
  [[ "$count" -ge 2 ]] && break
  sleep 1
done
for _ in $(seq 1 30); do docker exec "$container" pg_isready -U postgres -d operator_test >/dev/null 2>&1 && break; sleep 1; done

export DATABASE_URL="postgres://postgres:duitku_test_only@$(docker port "$container" 5432/tcp | head -1)/operator_test"
export NODE_ENV=test ADMIN_API_KEY=stack-test-admin JWT_SECRET=stack-test-jwt REDIS_URL=redis://127.0.0.1:1
export DUITKU_MERCHANT_CODE=MCH-DUITKU-SYNTHETIC DUITKU_API_KEY=synthetic-merchant-key-not-real
export APP_PUBLIC_URL=https://duitku-callback.example.test
export DOTENV_CONFIG_QUIET=true GMAIL_OAUTH_CLIENT_ID= GMAIL_OAUTH_CLIENT_SECRET= GMAIL_OAUTH_REFRESH_TOKEN= GMAIL_SENDER_EMAIL=

for f in migrations/*.sql; do
  if [[ "$(basename "$f")" == "066_duitku_payg_topups.sql" ]]; then
    docker exec -e PGPASSWORD=duitku_test_only "$container" psql -U postgres -d operator_test -v ON_ERROR_STOP=1 -c \
      "WITH t AS (INSERT INTO tenants(name,email,status) VALUES ('legacy-doku-migration-test','legacy-doku@example.test','active') RETURNING id) INSERT INTO wallet_topups(tenant_id,invoice_number,amount_idr) SELECT id,'TOP-LEGACY-MIGRATION',50000 FROM t" >/dev/null
  fi
  docker exec -e PGPASSWORD=duitku_test_only -i "$container" psql -U postgres -d operator_test -v ON_ERROR_STOP=1 < "$f" >/dev/null
done

node --require ts-node/register --test src/api-gateway/services/duitku-signature.test.ts src/api-gateway/duitku-sandbox.stack.ts
