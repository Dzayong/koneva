#!/usr/bin/env bash
# T1.5 tests run only in a fresh disposable PostgreSQL container.
set -euo pipefail
cd "$(dirname "$0")/.."
container="koneva-retention-test-$$"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run --rm -d --name "$container" --label koneva.purpose=operator-isolated-test \
  -e POSTGRES_PASSWORD=retention_test_only -e POSTGRES_DB=operator_test \
  -p 127.0.0.1::5432 postgres:15-alpine >/dev/null
for _ in {1..30}; do
  docker exec "$container" pg_isready -U postgres -d operator_test >/dev/null 2>&1 && break
  sleep 1
done
export RETENTION_TEST_DATABASE_URL="postgres://postgres:retention_test_only@$(docker port "$container" 5432/tcp | head -1)/operator_test"
export TZ=Asia/Jakarta
node scripts/test-data-retention.mjs
