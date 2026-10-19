#!/usr/bin/env bash
# Bounded, synthetic PostgreSQL benchmark for tenant DB-size estimation. Never uses a personal env file.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
name="koneva-cost-meter-test-$$"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run --rm -d --name "$name" --label koneva.purpose=operator-isolated-test \
  -e POSTGRES_PASSWORD=cost_meter_test_only -e POSTGRES_DB=koneva_cost_meter_test \
  -p 127.0.0.1::5432 postgres:15-alpine >/dev/null
ready=false
for _ in {1..45}; do
  if docker exec "$name" pg_isready -U postgres -d koneva_cost_meter_test >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
[[ $ready == true ]] || { echo 'Disposable PostgreSQL did not become ready.' >&2; exit 1; }
binding=$(docker port "$name" 5432/tcp | head -1)
export DATABASE_URL="postgres://postgres:cost_meter_test_only@${binding}/koneva_cost_meter_test"
export COST_METER_BENCHMARK=1
node --require ts-node/register scripts/benchmark-cost-meter.ts
