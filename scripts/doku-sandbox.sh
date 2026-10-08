#!/usr/bin/env bash
# Isolated DOKU sandbox runtime for end-to-end testing: disposable Postgres + disposable Redis +
# the ACTUAL local api-gateway code, all separate from the live `:13000`/`wa-personal` stack.
#
# Hard guarantees, by construction:
#   - Connection strings are built ONLY from this script's own disposable containers' docker-assigned
#     ports. There is no code path here that can read or point at .env.personal or wa-personal/wagateway.
#   - No device-manager, no bot container, no WhatsApp, no Gmail transport is started. Signup/order/
#     checkout/webhook work; device creation and message sending are untouched/unused here.
#   - DOKU_CLIENT_ID / DOKU_SHARED_KEY / APP_PUBLIC_URL are read from .env.doku-sandbox (private, mode
#     0600, gitignored) by `source`, never echoed, never passed as a CLI argument, never logged. Leave
#     them blank and every DOKU route answers 503 DOKU_NOT_CONFIGURED — fail-safe.
#   - This script never opens a tunnel and never sends a request to any DOKU host.
#
# Usage:
#   scripts/doku-sandbox.sh start         # idempotent: safe to run again if already running
#   scripts/doku-sandbox.sh restart-api   # after filling .env.doku-sandbox: reloads credentials only;
#                                          # Postgres/Redis and any data already in them are untouched
#   scripts/doku-sandbox.sh status
#   scripts/doku-sandbox.sh stop          # tears down everything, including the disposable DB/Redis data
#   scripts/doku-sandbox.sh logs [N]
set -euo pipefail
[[ $- != *x* ]] || { echo "Refusing to run under xtrace (would echo DOKU_SHARED_KEY to the terminal)." >&2; exit 1; }
cd "$(dirname "$0")/.."

PG_NAME=koneva-doku-sandbox-postgres
REDIS_NAME=koneva-doku-sandbox-redis
PG_PORT=15433
REDIS_PORT=16380
API_PORT=18200
ENV_FILE=.env.doku-sandbox
STATE_DIR=scripts/.doku-sandbox-state
PID_FILE="$STATE_DIR/api.pid"
LOG_FILE="$STATE_DIR/api.log"
MARKER="koneva-doku-sandbox-api-process"

ensure_env_template() {
  if [[ ! -f "$ENV_FILE" ]]; then
    umask 077
    cat > "$ENV_FILE" <<'EOF'
# DOKU sandbox — PRIVATE, gitignored, mode 0600. Owner fills this in directly on this machine; never
# paste any of these into chat, a commit, a log line, or an agent prompt.
#
# Blank (default): every DOKU route answers 503 DOKU_NOT_CONFIGURED. Everything else in the sandbox
# (signup, login, billing orders, etc.) still works without these.
DOKU_CLIENT_ID=
DOKU_SHARED_KEY=

# Must match whatever tunnel URL you're testing with THIS session (scripts/doku-sandbox.sh warns if this
# looks stale). Example, once localhost.run prints one: APP_PUBLIC_URL=https://abcd1234.lhr.life
APP_PUBLIC_URL=
EOF
    chmod 600 "$ENV_FILE"
    echo "Dibuat template baru: $ENV_FILE (mode 0600). Isi 3 nilai di atas secara privat sebelum uji DOKU nyata."
  fi
  chmod 600 "$ENV_FILE" 2>/dev/null || true
}

container_running() { docker ps --filter "name=^/$1\$" --filter status=running --format '{{.Names}}' | grep -qx "$1"; }

api_pid_alive() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid; pid=$(cat "$PID_FILE")
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

api_pid_is_ours() {
  # Identify by PID + cmdline + an env marker we set ourselves — never a broad pattern match — before
  # ever sending a signal, per this repo's own "identify by PID/cwd/env, not pkill -f" rule.
  local pid="$1"
  [[ -r "/proc/$pid/cmdline" ]] || return 1
  grep -qa "src/api-gateway/index.ts" "/proc/$pid/cmdline" || return 1
  grep -qa "$MARKER" "/proc/$pid/environ" 2>/dev/null
}

stop_api_only() {
  [[ -f "$PID_FILE" ]] || return 0
  local pid; pid=$(cat "$PID_FILE")
  if api_pid_alive; then
    if api_pid_is_ours "$pid"; then
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
      echo "API sandbox (PID $pid) dihentikan."
    else
      echo "PID $pid di $PID_FILE bukan proses sandbox ini (cmdline/marker tidak cocok) — tidak dihentikan." >&2
      return 1
    fi
  fi
  rm -f "$PID_FILE"
}

# Launches the API against WHATEVER Postgres/Redis are already up, re-reading .env.doku-sandbox fresh
# each time — this is the "restart only the sandbox runtime after filling credentials" step: it never
# touches the disposable containers, so any sandbox data created so far (e.g. a synthetic signup) survives.
launch_api() {
  local database_url="postgres://postgres:doku_sandbox_only@127.0.0.1:${PG_PORT}/doku_sandbox"
  # Deliberately NOT `set -a`: that would export an empty APP_PUBLIC_URL into this script's own
  # environment, which `env VAR=... command` then inherits regardless of what's listed below.
  #
  # Deliberately NOT `source`: that runs the file as shell code, so a value containing a space,
  # `$`, backtick, or quote (any of which a real secret may well contain) either breaks parsing or,
  # worse, gets executed. Each line is split on only its FIRST `=` via parameter expansion instead —
  # a literal read, never shell-evaluated.
  unset DOKU_CLIENT_ID DOKU_SHARED_KEY APP_PUBLIC_URL
  if [[ -f "$ENV_FILE" ]]; then
    local line key value
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ "$line" =~ ^[[:space:]]*(#.*)?$ ]] && continue
      key="${line%%=*}"; value="${line#*=}"
      case "$key" in DOKU_CLIENT_ID|DOKU_SHARED_KEY|APP_PUBLIC_URL) printf -v "$key" '%s' "$value" ;; esac
    done < "$ENV_FILE"
  fi
  local admin_key jwt_secret
  admin_key=$(head -c32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c40)
  jwt_secret=$(head -c32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c40)
  # config.ts validates APP_PUBLIC_URL with z.string().url() when present — an empty string is
  # neither a valid URL nor "absent", so it must be OMITTED entirely rather than set to "".
  local env_args=(
    "$MARKER=1" NODE_ENV=development PORT="$API_PORT"
    DATABASE_URL="$database_url" REDIS_URL="redis://127.0.0.1:${REDIS_PORT}"
    ADMIN_API_KEY="$admin_key" JWT_SECRET="$jwt_secret" SIGNUP_ENABLED=true
    EMAIL_TRANSPORT=dev-outbox DEV_EMAIL_OUTBOX_FILE="$PWD/${STATE_DIR}/email-outbox.jsonl"
    DOKU_CLIENT_ID="${DOKU_CLIENT_ID:-}" DOKU_SHARED_KEY="${DOKU_SHARED_KEY:-}"
  )
  [[ -n "${APP_PUBLIC_URL:-}" ]] && env_args+=(APP_PUBLIC_URL="$APP_PUBLIC_URL")
  env "${env_args[@]}" \
    nohup node --require ts-node/register src/api-gateway/index.ts >"$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  disown

  local ok=0
  for _ in $(seq 1 30); do
    curl -fs "http://127.0.0.1:${API_PORT}/ready" >/dev/null 2>&1 && { ok=1; break; }
    sleep 1
  done
  [[ "$ok" == 1 ]] || { echo "API sandbox tidak merespons /ready setelah 30s — lihat $LOG_FILE" >&2; return 1; }
  echo "API sandbox: PID $(cat "$PID_FILE"), port ${API_PORT}, log: $LOG_FILE"
}

print_banner() {
  local configured
  configured=$(grep -qE '^DOKU_CLIENT_ID=.+$' "$ENV_FILE" 2>/dev/null && grep -qE '^DOKU_SHARED_KEY=.+$' "$ENV_FILE" 2>/dev/null && echo yes || echo no)
  echo "=============================================================="
  echo " DOKU SANDBOX — isolated, disposable, not wa-personal/:13000"
  echo " API:     http://127.0.0.1:${API_PORT}"
  echo " Postgres: 127.0.0.1:${PG_PORT}/doku_sandbox (container $PG_NAME)"
  echo " Redis:    127.0.0.1:${REDIS_PORT} (container $REDIS_NAME)"
  echo " DOKU credentials configured: $configured (never printed here)"
  if ! grep -qE '^APP_PUBLIC_URL=.+$' "$ENV_FILE" 2>/dev/null; then
    echo " APP_PUBLIC_URL belum diisi — isi di $ENV_FILE sebelum tes checkout nyata."
  fi
  echo "=============================================================="
}

case "${1:-}" in
  start)
    ensure_env_template
    mkdir -p "$STATE_DIR"; chmod 700 "$STATE_DIR"

    if container_running "$PG_NAME"; then
      echo "Postgres sandbox sudah jalan ($PG_NAME)."
    else
      docker rm -f "$PG_NAME" >/dev/null 2>&1 || true
      docker run -d --name "$PG_NAME" --label koneva.purpose=doku-sandbox --restart unless-stopped \
        -e POSTGRES_PASSWORD=doku_sandbox_only -e POSTGRES_DB=doku_sandbox \
        -p "127.0.0.1:${PG_PORT}:5432" postgres:15-alpine >/dev/null
      for _ in $(seq 1 60); do
        count=$(docker logs "$PG_NAME" 2>&1 | grep -c "ready to accept connections" || true)
        [[ "$count" -ge 2 ]] && break
        sleep 1
      done
      for _ in $(seq 1 30); do docker exec "$PG_NAME" pg_isready -U postgres -d doku_sandbox >/dev/null 2>&1 && break; sleep 1; done
      echo "Postgres sandbox baru: $PG_NAME (127.0.0.1:${PG_PORT})"
    fi

    if container_running "$REDIS_NAME"; then
      echo "Redis sandbox sudah jalan ($REDIS_NAME)."
    else
      docker rm -f "$REDIS_NAME" >/dev/null 2>&1 || true
      docker run -d --name "$REDIS_NAME" --label koneva.purpose=doku-sandbox --restart unless-stopped \
        -p "127.0.0.1:${REDIS_PORT}:6379" redis:7-alpine >/dev/null
      for _ in $(seq 1 30); do docker exec "$REDIS_NAME" redis-cli ping >/dev/null 2>&1 && break; sleep 1; done
      echo "Redis sandbox baru: $REDIS_NAME (127.0.0.1:${REDIS_PORT})"
    fi

    DATABASE_URL="postgres://postgres:doku_sandbox_only@127.0.0.1:${PG_PORT}/doku_sandbox"
    echo "Menerapkan migrasi ke Postgres disposable (bukan wa-personal/wagateway)..."
    node scripts/retention-sandbox-helper.mjs migrate "$DATABASE_URL"

    if api_pid_alive; then
      echo "API sandbox sudah jalan (PID $(cat "$PID_FILE"), port ${API_PORT})."
    else
      launch_api
    fi
    print_banner
    ;;

  restart-api)
    # Restart ONLY the api-gateway process, re-reading .env.doku-sandbox — use this after filling in
    # DOKU_CLIENT_ID/DOKU_SHARED_KEY/APP_PUBLIC_URL. Postgres/Redis containers and their data are untouched.
    container_running "$PG_NAME" || { echo "Postgres sandbox tidak jalan — jalankan '$0 start' dulu." >&2; exit 1; }
    stop_api_only
    launch_api
    print_banner
    ;;

  status)
    for c in "$PG_NAME" "$REDIS_NAME"; do
      container_running "$c" && echo "RUNNING: $c" || echo "stopped: $c"
    done
    if api_pid_alive; then
      echo "RUNNING: api-gateway sandbox (PID $(cat "$PID_FILE"), port ${API_PORT})"
      curl -fs "http://127.0.0.1:${API_PORT}/ready" 2>&1 | sed 's/^/  \/ready -> /' || echo "  /ready -> tidak merespons"
    else
      echo "stopped: api-gateway sandbox"
    fi
    ;;

  stop)
    stop_api_only || echo "Lanjut menghapus container sandbox walau proses API di atas tidak dihentikan." >&2
    docker rm -f "$PG_NAME" "$REDIS_NAME" >/dev/null 2>&1 || true
    echo "Container sandbox dihentikan dan dihapus (disposable — data ikut hilang, sesuai desain)."
    ;;

  logs)
    [[ -f "$LOG_FILE" ]] && tail -n "${2:-60}" "$LOG_FILE" || echo "Belum ada log ($LOG_FILE)."
    ;;

  *)
    echo "usage: $0 {start|restart-api|status|stop|logs [N]}" >&2
    exit 1
    ;;
esac
