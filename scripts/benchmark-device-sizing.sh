#!/usr/bin/env bash
# Disposable local sizing probe. No ports are published and WhatsApp is hard-forced to mock.
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_ID="$(date +%Y%m%d%H%M%S)-$$"
PREFIX="koneva-t31-${RUN_ID}"
NETWORK="${PREFIX}-net"
PG="${PREFIX}-pg"
REDIS="${PREFIX}-redis"
API_IMAGE="${PREFIX}-api:local"
BOT_IMAGE="${PREFIX}-bot:local"
ARTIFACT_DIR="${ARTIFACT_DIR:-${TMPDIR:-/tmp}/${PREFIX}}"
SESSION_DIR="${ARTIFACT_DIR}/sessions"
SAMPLES=15
QUEUE_MESSAGES="${QUEUE_MESSAGES:-1000}"

mkdir -p "$ARTIFACT_DIR" "$SESSION_DIR"
cleanup() {
  local i
  docker rm -f "${PREFIX}-load" "$PG" "$REDIS" >/dev/null 2>&1 || true
  for i in 01 02 03 04 05; do docker rm -f "wa-bot-t31-${RUN_ID//[^a-zA-Z0-9]/}-${i}" >/dev/null 2>&1 || true; done
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  docker image rm "$API_IMAGE" "$BOT_IMAGE" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

command -v docker >/dev/null || { echo 'Docker is required.' >&2; exit 1; }
docker info >/dev/null
command -v python3 >/dev/null || { echo 'python3 is required for percentile summaries.' >&2; exit 1; }

echo "Artifacts: $ARTIFACT_DIR"
echo 'Building isolated API migration and bot images...'
docker build -q -f "$ROOT_DIR/docker/app.Dockerfile" --target api-gateway -t "$API_IMAGE" "$ROOT_DIR" >/dev/null
docker build -q -f "$ROOT_DIR/docker/bot-container.Dockerfile" -t "$BOT_IMAGE" "$ROOT_DIR" >/dev/null

# Runtime containers cannot reach the public internet from this bridge.
docker network create --internal "$NETWORK" >/dev/null
docker run -d --name "$PG" --network "$NETWORK" --network-alias pg \
  -e POSTGRES_PASSWORD=benchmark-only -e POSTGRES_DB=koneva postgres:15-alpine >/dev/null
docker run -d --name "$REDIS" --network "$NETWORK" --network-alias redis \
  redis:7-alpine redis-server --save '' --appendonly no >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$PG" pg_isready -U postgres -d koneva >/dev/null 2>&1 \
    && docker exec "$REDIS" redis-cli ping 2>/dev/null | grep -q PONG; then break; fi
  sleep 1
done
docker exec "$PG" pg_isready -U postgres -d koneva >/dev/null

docker run --rm --network "$NETWORK" \
  -e NODE_ENV=test -e DATABASE_URL=postgresql://postgres:benchmark-only@pg:5432/koneva \
  -e REDIS_URL=redis://redis:6379 \
  -e JWT_SECRET=benchmark-only-jwt-secret-012345678901234567890 \
  -e ADMIN_API_KEY=benchmark-only-admin-key-012345678901234567890 \
  "$API_IMAGE" node dist/scripts/migrate.js >"$ARTIFACT_DIR/migrations.log" 2>&1

docker exec "$PG" psql -U postgres -d koneva -v ON_ERROR_STOP=1 -c \
  "INSERT INTO tenants(name,email,api_key,max_devices,quota_messages,status,webhook_secret) VALUES ('T3.1 synthetic','t31@example.invalid','benchmark-only-key',5,100000,'active','benchmark-only-webhook-secret');" >/dev/null
docker exec "$PG" psql -U postgres -d koneva -v ON_ERROR_STOP=1 -c \
  "INSERT INTO subscriptions(tenant_id,plan_id,status,cycle,period_start,period_end) SELECT id,'umkm','active','monthly',now(),now()+interval '30 days' FROM tenants WHERE email='t31@example.invalid';" >/dev/null
docker exec "$PG" psql -U postgres -d koneva -v ON_ERROR_STOP=1 -c \
  "INSERT INTO recipient_preferences(tenant_id,phone_number,status,source,evidence_ref) SELECT id,'1000000000000','opted_in','inbound_keyword','t31-synthetic-fixture' FROM tenants WHERE email='t31@example.invalid';" >/dev/null
for i in 01 02 03 04 05; do
  docker exec "$PG" psql -U postgres -d koneva -v ON_ERROR_STOP=1 -c \
    "INSERT INTO devices(tenant_id,device_key,label,status) SELECT id,'WAPI-T31-${i}','Synthetic ${i}','online' FROM tenants WHERE email='t31@example.invalid';" >/dev/null
done

start_bot() {
  local i="$1" key="WAPI-T31-$1" name="wa-bot-t31-${RUN_ID//[^a-zA-Z0-9]/}-$1"
  mkdir -p "$SESSION_DIR/$key"
  chmod 700 "$SESSION_DIR/$key"
  docker run -d --name "$name" --network "$NETWORK" \
    --label "wa.gateway.network=$NETWORK" --label "wa.gateway.device=$key" \
    --memory 512m --memory-swap 512m --pids-limit 256 \
    -e NODE_ENV=test -e KONEVA_SANDBOX=1 -e WHATSAPP_TRANSPORT=real -e T31_QUEUE_BENCHMARK=1 \
    -e BOT_ID="$key" -e BOT_API_KEYS=benchmark-only-key \
    -e DATABASE_URL=postgresql://postgres:benchmark-only@pg:5432/koneva \
    -e REDIS_URL=redis://redis:6379 \
    -e JWT_SECRET=benchmark-only-jwt-secret-012345678901234567890 \
    -e ADMIN_API_KEY=benchmark-only-admin-key-012345678901234567890 \
    -e SESSION_PATH=/tmp/bot-sessions -v "$SESSION_DIR/$key:/tmp/bot-sessions" \
    "$BOT_IMAGE" >/dev/null
}

wait_bot_http() {
  local name="$1"
  python3 - "$name" <<'PY'
import subprocess,sys,time
name=sys.argv[1]
probe="fetch('http://127.0.0.1:9000/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"
deadline=time.monotonic()+60
while time.monotonic()<deadline:
    result=subprocess.run(['docker','exec',name,'node','-e',probe],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    if result.returncode==0: sys.exit(0)
    time.sleep(.25)
sys.exit(f'Bot health endpoint did not become ready: {name}')
PY
}

sample() {
  local phase="$1"; shift
  local names=("$@")
  local file="$ARTIFACT_DIR/${phase}.csv"
  : >"$file"
  for _ in $(seq 1 "$SAMPLES"); do
    docker stats --no-stream --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}}' "${names[@]}" >>"$file"
    sleep 1
  done
}

start_queue_workload() {
  local i="$1" name="wa-bot-t31-${RUN_ID//[^a-zA-Z0-9]/}-$1"
  docker exec -d "$name" sh -c \
    "echo running >/tmp/t31-queue-exit; T31_QUEUE_BENCHMARK=1 node /app/dist/src/bot-container/benchmark-queue-worker.js --count=${QUEUE_MESSAGES} >/tmp/t31-queue-worker.log 2>&1; result=\$?; echo \$result >/tmp/t31-queue-exit; exit \$result"
}

sample_during_queue() {
  local phase="$1"; shift
  local suffixes=("$@") names=() file="$ARTIFACT_DIR/${phase}.csv" completed=0
  local suffix
  for suffix in "${suffixes[@]}"; do names+=("wa-bot-t31-${RUN_ID//[^a-zA-Z0-9]/}-$suffix"); done
  : >"$file"
  for _ in $(seq 1 "$SAMPLES"); do
    docker stats --no-stream --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}}' "${names[@]}" >>"$file"
    completed=1
    for i in "${suffixes[@]}"; do
      local name="wa-bot-t31-${RUN_ID//[^a-zA-Z0-9]/}-$i"
      local exit_code
      exit_code="$(docker exec "$name" sh -c 'cat /tmp/t31-queue-exit 2>/dev/null || echo running' 2>/dev/null || echo running)"
      if [[ "$exit_code" == "running" ]]; then completed=0; fi
    done
    [[ "$completed" == 1 ]] && break
    sleep 1
  done
  for i in "${suffixes[@]}"; do
    local name="wa-bot-t31-${RUN_ID//[^a-zA-Z0-9]/}-$i"
    local deadline=$((SECONDS + 180)) exit_code=running
    while (( SECONDS < deadline )); do
      exit_code="$(docker exec "$name" sh -c 'cat /tmp/t31-queue-exit 2>/dev/null || echo running' 2>/dev/null || echo running)"
      [[ "$exit_code" != "running" ]] && break
      sleep 1
    done
    if [[ "$exit_code" != "0" ]]; then docker exec "$name" cat /tmp/t31-queue-worker.log >&2 || true; echo "Queue workload failed for synthetic device $i (exit=$exit_code)." >&2; exit 1; fi
    docker exec "$name" cat /tmp/t31-queue-worker.log >>"$ARTIFACT_DIR/${phase}-queue-results.jsonl"
  done
}

start_bot 01
wait_bot_http "wa-bot-t31-${RUN_ID//[^a-zA-Z0-9]/}-01"
sample 1-idle "wa-bot-t31-${RUN_ID//[^a-zA-Z0-9]/}-01"

docker run -d --name "${PREFIX}-load" --network "$NETWORK" alpine:3.20 sh -c \
  'ok=0; fail=0; n=0; while true; do if wget -qO- http://wa-bot-t31-'"${RUN_ID//[^a-zA-Z0-9]/}"'-01:9000/health >/dev/null; then ok=$((ok+1)); else fail=$((fail+1)); fi; n=$((n+1)); if [ "$n" -ge 10 ]; then echo "checks_ok=$ok checks_failed=$fail"; ok=0; fail=0; n=0; fi; sleep 0.05; done' >/dev/null
start_queue_workload 01
sample_during_queue 1-active 01
docker logs "${PREFIX}-load" >"$ARTIFACT_DIR/1-active-probes.log" 2>&1
if grep -Eq 'checks_failed=[1-9]' "$ARTIFACT_DIR/1-active-probes.log"; then echo 'Health probe failures in 1-active phase.' >&2; exit 1; fi

for i in 02 03 04 05; do start_bot "$i"; wait_bot_http "wa-bot-t31-${RUN_ID//[^a-zA-Z0-9]/}-${i}"; done
docker rm -f "${PREFIX}-load" >/dev/null
docker run -d --name "${PREFIX}-load" --network "$NETWORK" alpine:3.20 sh -c \
  'ok=0; fail=0; n=0; while true; do for suffix in 01 02 03 04 05; do if wget -qO- http://wa-bot-t31-'"${RUN_ID//[^a-zA-Z0-9]/}"'-${suffix}:9000/health >/dev/null; then ok=$((ok+1)); else fail=$((fail+1)); fi; done; n=$((n+1)); if [ "$n" -ge 10 ]; then echo "checks_ok=$ok checks_failed=$fail"; ok=0; fail=0; n=0; fi; sleep 0.05; done' >/dev/null
for i in 01 02 03 04 05; do start_queue_workload "$i"; done
sample_during_queue 5-active 01 02 03 04 05
docker logs "${PREFIX}-load" >"$ARTIFACT_DIR/5-active-probes.log" 2>&1
if grep -Eq 'checks_failed=[1-9]' "$ARTIFACT_DIR/5-active-probes.log"; then echo 'Health probe failures in 5-active phase.' >&2; exit 1; fi

python3 - "$ARTIFACT_DIR" <<'PY'
import math, re, statistics, sys
from pathlib import Path
root = Path(sys.argv[1])
print('Scenario | samples/device | CPU p50/p95 | RAM p50/p95/max per device')
for phase in ('1-idle', '1-active', '5-active'):
    rows=[]
    for line in (root / f'{phase}.csv').read_text().splitlines():
        match=re.fullmatch(r'[^,]+,([\d.]+)%,([\d.]+)MiB / ([\d.]+)MiB', line)
        if match: rows.append((float(match.group(1)), float(match.group(2))))
    cpu=[row[0] for row in rows]; ram=[row[1] for row in rows]
    if not rows: raise SystemExit(f'No parseable docker stats in {phase}')
    p95=lambda xs: sorted(xs)[max(0, math.ceil(.95*len(xs))-1)]
    devices=5 if phase=='5-active' else 1
    rounds=len(rows)//devices
    print(f'{phase} | {rounds} | {statistics.median(cpu):.2f}%/{p95(cpu):.2f}% | {statistics.median(ram):.2f}/{p95(ram):.2f}/{max(ram):.2f} MiB')
print(f'Raw samples and probe logs: {root}')
for phase in ('1-active', '5-active'):
    reports=root / f'{phase}-queue-results.jsonl'
    if reports.exists():
        print(f'{phase} fake-transport worker results:')
        for line in reports.read_text().splitlines():
            if line.startswith('{'): print(line)
PY

# A fresh process start is validated directly over its private bridge network.
python3 - "$NETWORK" "wa-bot-t31-${RUN_ID//[^a-zA-Z0-9]/}-01" <<'PY' | tee "$ARTIFACT_DIR/restart-recovery.txt"
import subprocess,sys,time
network,name=sys.argv[1:]
start=time.monotonic(); subprocess.run(['docker','restart',name],check=True,stdout=subprocess.DEVNULL)
probe="fetch('http://127.0.0.1:9000/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"
while time.monotonic()-start < 60:
    result=subprocess.run(['docker','exec',name,'node','-e',probe],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    if result.returncode==0: break
    time.sleep(.25)
print(f'restart_to_http_200_s={time.monotonic()-start:.2f}; success={result.returncode==0}')
PY

docker exec "$PG" psql -U postgres -d koneva -Atc 'SELECT count(*) FROM messages' >"$ARTIFACT_DIR/synthetic-message-count.txt"
du -sb "$SESSION_DIR" >"$ARTIFACT_DIR/session-storage-bytes.txt"
echo 'All bot processes ran with KONEVA_SANDBOX=1; their regular WhatsApp connections were refused before Baileys/session/network setup.'
echo 'The guarded bot-process queue worker used an in-memory fake socket; no message was handed to WhatsApp.'
