#!/usr/bin/env bash
# Prove duplicate bot processes are rejected using disposable PostgreSQL/Redis and sandbox transport.
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_ID="$(date +%Y%m%d%H%M%S)-$$"
PREFIX="koneva-lease-${RUN_ID}"
NETWORK="${PREFIX}-net"
PG="${PREFIX}-pg"
REDIS="${PREFIX}-redis"
API_IMAGE="${PREFIX}-api:local"
BOT_IMAGE="${PREFIX}-bot:local"
ARTIFACT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
FIRST="${PREFIX}-same-a"
DUPLICATE="${PREFIX}-same-b"
OTHER="${PREFIX}-other"

cleanup() {
  docker rm -f "$FIRST" "$DUPLICATE" "$OTHER" "$PG" "$REDIS" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  docker image rm "$API_IMAGE" "$BOT_IMAGE" >/dev/null 2>&1 || true
  if [[ "${status:-0}" != 0 ]]; then
    echo "Test failed (exit $status); disposable logs follow:" >&2
    for file in "$ARTIFACT_DIR"/*.log; do [[ -f "$file" ]] && { echo "--- $file" >&2; cat "$file" >&2; }; done
  fi
  rm -rf "$ARTIFACT_DIR"
}
trap 'status=$?; cleanup' EXIT
trap 'exit 130' INT TERM

command -v docker >/dev/null || { echo 'Docker is required.' >&2; exit 1; }
docker info >/dev/null

echo 'Building isolated API and bot images...'
docker build -q -f "$ROOT_DIR/docker/app.Dockerfile" --target api-gateway -t "$API_IMAGE" "$ROOT_DIR" >/dev/null
docker build -q -f "$ROOT_DIR/docker/bot-container.Dockerfile" -t "$BOT_IMAGE" "$ROOT_DIR" >/dev/null

# --internal removes public network egress. KONEVA_SANDBOX independently hard-forces mock transport.
docker network create --internal "$NETWORK" >/dev/null
docker run -d --name "$PG" --network "$NETWORK" --network-alias pg \
  -e POSTGRES_PASSWORD=lease-test-only -e POSTGRES_DB=koneva postgres:15-alpine >/dev/null
docker run -d --name "$REDIS" --network "$NETWORK" --network-alias redis \
  redis:7-alpine redis-server --save '' --appendonly no >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$PG" pg_isready -U postgres -d koneva >/dev/null 2>&1 \
    && docker exec "$REDIS" redis-cli ping 2>/dev/null | grep -q PONG; then break; fi
  sleep 1
done
docker exec "$PG" pg_isready -U postgres -d koneva >/dev/null
if ! docker run --rm --network "$NETWORK" \
  -e NODE_ENV=test -e DATABASE_URL=postgresql://postgres:lease-test-only@pg:5432/koneva \
  -e REDIS_URL=redis://redis:6379 \
  -e JWT_SECRET=lease-test-jwt-secret-012345678901234567890 \
  -e ADMIN_API_KEY=lease-test-admin-key-012345678901234567890 \
  "$API_IMAGE" node dist/scripts/migrate.js >"$ARTIFACT_DIR/migrations.log" 2>&1; then
  cat "$ARTIFACT_DIR/migrations.log" >&2
  exit 1
fi

start_bot() {
  local name="$1" bot_id="$2"
  docker run -d --name "$name" --network "$NETWORK" \
    -e NODE_ENV=test -e KONEVA_SANDBOX=1 -e WHATSAPP_TRANSPORT=real -e T31_QUEUE_BENCHMARK=1 \
    -e BOT_ID="$bot_id" -e BOT_API_KEYS=lease-test-bot-key \
    -e DATABASE_URL=postgresql://postgres:lease-test-only@pg:5432/koneva \
    -e REDIS_URL=redis://redis:6379 \
    -e JWT_SECRET=lease-test-jwt-secret-012345678901234567890 \
    -e ADMIN_API_KEY=lease-test-admin-key-012345678901234567890 \
    -e SESSION_PATH=/tmp/bot-sessions -e BOT_CONTAINER_PORT=9000 \
    "$BOT_IMAGE" >/dev/null
}

wait_healthy() {
  local name="$1"
  for _ in $(seq 1 120); do
    if docker exec "$name" node -e "fetch('http://127.0.0.1:9000/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then return 0; fi
    if [[ "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null || true)" != true ]]; then
      docker logs "$name" >&2 || true
      echo "Bot exited before becoming healthy: $name" >&2
      return 1
    fi
    sleep 0.25
  done
  docker logs "$name" >&2 || true
  echo "Bot health check timed out: $name" >&2
  return 1
}

start_bot "$FIRST" WAPI-T31-01
wait_healthy "$FIRST"

start_bot "$DUPLICATE" WAPI-T31-01
duplicate_exit="$(docker wait "$DUPLICATE")"
docker logs "$DUPLICATE" >"$ARTIFACT_DIR/duplicate.log" 2>&1 || true
if [[ "$duplicate_exit" == 0 ]] || ! grep -q 'already owns device' "$ARTIFACT_DIR/duplicate.log"; then
  cat "$ARTIFACT_DIR/duplicate.log" >&2
  echo 'Duplicate bot did not fail with the expected device-lease error.' >&2
  exit 1
fi
if [[ "$(docker inspect -f '{{.State.Running}}' "$FIRST")" != true ]]; then
  echo 'The original bot stopped while the duplicate was rejected.' >&2
  exit 1
fi

start_bot "$OTHER" WAPI-T31-02
wait_healthy "$OTHER"

echo 'PASS: same BOT_ID duplicate exited before socket startup; distinct BOT_ID ran concurrently.'
echo 'Safety: disposable internal Docker network, disposable PostgreSQL/Redis, KONEVA_SANDBOX=1, fake transport only.'
