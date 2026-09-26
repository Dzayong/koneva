#!/usr/bin/env bash
# Static checks only: no live data changes or sending WhatsApp messages.
set -Eeuo pipefail
task_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
for script in "$task_root"/scripts/*personal*.sh; do bash -n "$script"; done
export DB_PASSWORD=0123456789abcdef0123456789abcdef
export REDIS_PASSWORD=$DB_PASSWORD JWT_SECRET=$DB_PASSWORD ADMIN_API_KEY=$DB_PASSWORD
export SESSION_HOST_PATH="$task_root/data/personal/sessions"
export PERSONAL_UID="$(id -u)" PERSONAL_GID="$(id -g)" DOCKER_GID=999
docker compose --env-file /dev/null -f "$task_root/docker/docker-compose.personal.yml" --profile with-nginx config --quiet
echo 'Personal shell syntax and Compose configuration validated.'
