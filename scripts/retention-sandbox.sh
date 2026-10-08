#!/usr/bin/env bash
# One-command, fail-closed lifecycle for the disposable T1.5 retention sandbox
# (owner-approved 2026-10-01 manual multi-day retention test environment).
#
# Hard guarantees, by construction, not by convention:
#   - This script NEVER reads .env.personal or the repo's own DATABASE_URL. The only
#     connection string that exists is built from THIS container's own docker-assigned
#     loopback port, created fresh by `start`. There is no code path that can point any
#     command here at the live wa-personal/wagateway database.
#   - The scheduler (`scripts/data-retention.ts --schedule`) is never started by this
#     script. Only one-shot `run` invocations (dry-run by default) are possible.
#   - `run <job> --execute` is refused if another job already executed today (state
#     file), matching the "one category per day" rule from the owner-approved plan.
#
# Usage:
#   scripts/retention-sandbox.sh start
#   scripts/retention-sandbox.sh status
#   scripts/retention-sandbox.sh seed <job>
#   scripts/retention-sandbox.sh run <job> [--execute]
#   scripts/retention-sandbox.sh stop
# Jobs: messages_90d | webhook_logs_30d | security_logs_12mo | closed_accounts_30d | invoices_10y
set -euo pipefail
cd "$(dirname "$0")/.."

NAME=koneva-retention-sandbox
STATE_DIR=scripts/.retention-sandbox-state
STATE_FILE="$STATE_DIR/connection.env"
LOG_FILE="$STATE_DIR/log.jsonl"
HELPER=scripts/retention-sandbox-helper.mjs

is_running() {
  docker ps --filter "name=^/${NAME}$" --filter "status=running" --format '{{.Names}}' | grep -qx "$NAME"
}

require_started() {
  is_running || { echo "Sandbox tidak jalan. Jalankan: $0 start" >&2; exit 1; }
  [[ -f "$STATE_FILE" ]] || { echo "State hilang ($STATE_FILE) walau container jalan — jalankan: $0 stop lalu start" >&2; exit 1; }
}

cmd="${1:-}"; [[ $# -gt 0 ]] && shift || true

case "$cmd" in
  start)
    mkdir -p "$STATE_DIR"; chmod 700 "$STATE_DIR"
    if is_running; then
      echo "Sandbox sudah jalan."
      [[ -f "$STATE_FILE" ]] && grep -v RUNNER_URL "$STATE_FILE" || true
      exit 0
    fi
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    PG_PW=$(head -c32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c24)
    docker run -d --name "$NAME" --label koneva.purpose=retention-sandbox \
      -e POSTGRES_PASSWORD="$PG_PW" -e POSTGRES_DB=operator_test \
      -p 127.0.0.1::5432 postgres:15-alpine >/dev/null
    # postgres:15-alpine's entrypoint starts the server once for initdb, shuts it down, then
    # restarts — pg_isready can report healthy during the first, short-lived instance. Wait
    # for "ready to accept connections" to appear *twice* in the log before trusting it.
    for _ in $(seq 1 60); do
      count=$(docker logs "$NAME" 2>&1 | grep -c "ready to accept connections" || true)
      [[ "$count" -ge 2 ]] && break
      sleep 1
    done
    PORT=$(docker port "$NAME" 5432/tcp | head -1 | cut -d: -f2)
    ADMIN_URL="postgres://postgres:${PG_PW}@127.0.0.1:${PORT}/operator_test"
    for _ in $(seq 1 30); do
      docker exec "$NAME" pg_isready -U postgres -d operator_test >/dev/null 2>&1 && break
      sleep 1
    done
    RUNNER_PW=$(head -c32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c24)
    RUNNER_URL="postgres://retention_sandbox_runner:${RUNNER_PW}@127.0.0.1:${PORT}/operator_test"

    echo "Menerapkan migrasi ke sandbox (disposable, bukan produksi)..."
    node "$HELPER" migrate "$ADMIN_URL"
    echo "Membuat login non-superuser khusus retensi..."
    node "$HELPER" create-runner "$ADMIN_URL" "$RUNNER_PW"

    umask 077
    { echo "PORT=$PORT"; echo "ADMIN_URL=$ADMIN_URL"; echo "RUNNER_URL=$RUNNER_URL"; } > "$STATE_FILE"

    echo "=============================================================="
    echo " SANDBOX DISPOSABLE — BUKAN PRODUKSI (koneva-retention-sandbox)"
    echo " DB: operator_test di 127.0.0.1:${PORT}"
    echo " Scheduler TIDAK dijalankan. Hanya dry-run/execute manual via 'run'."
    echo "=============================================================="
    ;;

  status)
    if is_running; then
      echo "RUNNING: $NAME"
      [[ -f "$STATE_FILE" ]] && grep PORT "$STATE_FILE" || true
    else
      echo "STOPPED"
    fi
    [[ -f "$LOG_FILE" ]] && { echo "--- riwayat run ---"; cat "$LOG_FILE"; } || true
    ;;

  seed)
    job="${1:-}"; [[ -n "$job" ]] || { echo "usage: $0 seed <job>" >&2; exit 1; }
    require_started
    # shellcheck disable=SC1090
    source "$STATE_FILE"
    node "$HELPER" seed "$ADMIN_URL" "$job"
    ;;

  run)
    job="${1:-}"; shift || true
    execute=0
    [[ "${1:-}" == "--execute" ]] && execute=1
    [[ -n "$job" ]] || { echo "usage: $0 run <job> [--execute]" >&2; exit 1; }
    case "$job" in messages_90d|webhook_logs_30d|security_logs_12mo|closed_accounts_30d|invoices_10y) ;; *) echo "job tidak dikenal: $job" >&2; exit 1 ;; esac
    require_started
    # shellcheck disable=SC1090
    source "$STATE_FILE"

    today=$(date -u +%F)
    marker="$STATE_DIR/executed-${today}.txt"
    if [[ "$execute" == 1 ]]; then
      if [[ -f "$marker" ]]; then
        existing=$(cat "$marker")
        if [[ "$existing" != "$job" ]]; then
          echo "DITOLAK: kategori '$existing' sudah di-execute hari ini ($today). Satu kategori per hari — coba '$job' besok." >&2
          exit 1
        fi
        echo "Catatan: '$job' sudah pernah di-execute hari ini; menjalankan ulang (idempotent check), bukan kategori kedua." >&2
      fi
    fi

    mode="dry-run"
    env_args=(RETENTION_DATABASE_URL="$RUNNER_URL")
    args=(--job "$job")
    if [[ "$execute" == 1 ]]; then
      mode="execute"
      env_args+=(RETENTION_DELETE_ENABLED=true RETENTION_LIVE_DELETE_APPROVED=true)
      args+=(--execute)
    fi

    echo "Menjalankan job=$job mode=$mode terhadap sandbox disposable (127.0.0.1:${PORT})..."
    set +e
    output=$(env "${env_args[@]}" node --require ts-node/register scripts/data-retention.ts "${args[@]}" 2>&1)
    status=$?
    set -e
    echo "$output"

    mkdir -p "$STATE_DIR"
    node -e "
      const fs=require('fs');
      const line={ts:new Date().toISOString(), job:process.argv[1], mode:process.argv[2], exit_code:Number(process.argv[3])};
      fs.appendFileSync(process.argv[4], JSON.stringify(line)+'\n');
    " "$job" "$mode" "$status" "$LOG_FILE"

    if [[ "$execute" == 1 && "$status" == 0 ]]; then
      echo "$job" > "$marker"
    fi
    exit "$status"
    ;;

  stop)
    docker rm -f "$NAME" >/dev/null 2>&1 && echo "Dihentikan dan dihapus: $NAME" || echo "Tidak jalan."
    rm -f "$STATE_FILE"
    echo "Riwayat run ($LOG_FILE) dipertahankan untuk bukti Gerbang 1."
    ;;

  *)
    echo "usage: $0 {start|status|seed <job>|run <job> [--execute]|stop}" >&2
    exit 1
    ;;
esac
