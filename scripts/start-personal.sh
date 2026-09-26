#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/personal-common.sh"
if [[ ! -e "$PERSONAL_ENV_FILE" ]]; then
  umask 077
  cp "$PERSONAL_ROOT/.env.personal.example" "$PERSONAL_ENV_FILE"
  for key in DB_PASSWORD REDIS_PASSWORD JWT_SECRET ADMIN_API_KEY; do
    secret="$(openssl rand -hex 32)"
    sed -i "s/^$key=$/$key=$secret/" "$PERSONAL_ENV_FILE"
  done
  echo "Generated credentials in $PERSONAL_ENV_FILE (mode 600)."
fi
personal_load
personal_lock
mkdir -p "$SESSION_HOST_PATH" "$BACKUP_DIR" "$PERSONAL_ROOT/docker/nginx/"{generated,ssl,www}
chmod 700 "$SESSION_HOST_PATH" "$BACKUP_DIR"
chmod 755 "$PERSONAL_ROOT/docker/nginx/generated" "$PERSONAL_ROOT/docker/nginx/www"
"$PERSONAL_ROOT/scripts/render-personal-nginx.sh"
"${COMPOSE[@]}" config --quiet
echo 'Building API, manager, dashboard, and bot images...'
"${COMPOSE[@]}" build api-gateway device-manager dashboard bot-image
"${COMPOSE[@]}" up -d --wait --wait-timeout 180 postgres redis
# Compiled migrations run BEFORE the new application starts, including updates.
"${COMPOSE[@]}" run --rm migrate
"${COMPOSE[@]}" up -d --wait --wait-timeout 180
resume_file="$PERSONAL_ROOT/data/personal/$PERSONAL_PROJECT.stopped-bots"
if [[ -f $resume_file ]]; then
  while read -r bot; do
    [[ $bot =~ ^[a-f0-9]+$ ]] || continue
    network="$(docker inspect --format '{{index .Config.Labels "wa.gateway.network"}}' "$bot" 2>/dev/null || true)"
    if [[ $network == "$BOT_DOCKER_NETWORK" ]]; then docker start "$bot" >/dev/null; fi
  done < "$resume_file"
  rm -- "$resume_file"
fi
"$PERSONAL_ROOT/scripts/monitor-personal.sh"
echo "Dashboard: http://localhost:${DASHBOARD_PORT:-13000}"
echo "API: http://localhost:${API_PORT:-18000}"
echo 'Create your tenant/API key using docs/PERSONAL_SETUP.md.'
