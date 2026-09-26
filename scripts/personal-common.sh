#!/usr/bin/env bash
# Sourced by personal scripts. Run on the Linux host owning the Docker socket.
set -Eeuo pipefail
PERSONAL_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
export PERSONAL_ENV_FILE="${PERSONAL_ENV_FILE:-$PERSONAL_ROOT/.env.personal}"
die() { echo "Error: $*" >&2; exit 1; }

personal_load() {
  [[ -f "$PERSONAL_ENV_FILE" ]] || die "Missing $PERSONAL_ENV_FILE; run make start or copy .env.personal.example."
  # Only load a locally controlled file, never download or execute remote envs.
  set -a
  source "$PERSONAL_ENV_FILE"
  set +a
  for key in DB_PASSWORD REDIS_PASSWORD JWT_SECRET ADMIN_API_KEY; do
    [[ ${!key:-} =~ ^[a-zA-Z0-9_-]{32,}$ ]] || die "$key must contain at least 32 URL-safe characters."
  done
  [[ ${DB_USER:-wagateway} =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] || die 'Invalid DB_USER'
  [[ ${DB_NAME:-wagateway} =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] || die 'Invalid DB_NAME'
  export PERSONAL_PROJECT="${PERSONAL_PROJECT:-wa-personal}"
  export BOT_DOCKER_NETWORK="${BOT_DOCKER_NETWORK:-wa-gateway-personal}"
  [[ $PERSONAL_PROJECT =~ ^[a-z0-9][a-z0-9_-]+$ ]] || die 'Invalid PERSONAL_PROJECT'
  export SESSION_HOST_PATH="${SESSION_HOST_PATH:-$PERSONAL_ROOT/data/personal/sessions}"
  export BACKUP_DIR="${BACKUP_DIR:-$PERSONAL_ROOT/backups/personal}"
  [[ $SESSION_HOST_PATH == /* && $BACKUP_DIR == /* ]] || die 'Session and backup paths must be absolute.'
  [[ $SESSION_HOST_PATH != / && $BACKUP_DIR != / && $BACKUP_DIR != "$PERSONAL_ROOT" ]] || die 'Use dedicated data directories.'
  export PERSONAL_UID="$(id -u)" PERSONAL_GID="$(id -g)"
  [[ -S /var/run/docker.sock ]] || die 'Local Linux Docker socket /var/run/docker.sock is required.'
  export DOCKER_GID="$(stat -c '%g' /var/run/docker.sock)"
  docker compose version >/dev/null
  docker info >/dev/null
  COMPOSE=(docker compose --env-file "$PERSONAL_ENV_FILE" -p "$PERSONAL_PROJECT" -f "$PERSONAL_ROOT/docker/docker-compose.personal.yml")
}

personal_lock() {
  mkdir -p "$PERSONAL_ROOT/data/personal"
  if [[ ${PERSONAL_LOCK_HELD:-} != "$PERSONAL_PROJECT" ]]; then
    exec 9>"$PERSONAL_ROOT/data/personal/$PERSONAL_PROJECT.lock"
    flock -n 9 || die 'Another personal-stack operation is running.'
    export PERSONAL_LOCK_HELD="$PERSONAL_PROJECT"
  fi
}

personal_bot_ids() {
  docker ps "$@" --filter "label=wa.gateway.network=$BOT_DOCKER_NETWORK" --format '{{.ID}}'
}
