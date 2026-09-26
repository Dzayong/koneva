#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/personal-common.sh"
personal_load
failed=0
services=(postgres redis api-gateway device-manager dashboard)
if [[ ,${COMPOSE_PROFILES:-}, == *,with-nginx,* ]]; then services+=(nginx); fi
for service in "${services[@]}"; do
  container="$("${COMPOSE[@]}" ps -a -q "$service")"
  if [[ -z $container ]]; then echo "DOWN $service: missing"; failed=1; continue; fi
  state="$(docker inspect --format '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$container")"
  echo "$service: $state"
  [[ $state == running/healthy ]] || failed=1
done
mapfile -t bots < <(personal_bot_ids -a)
for bot in "${bots[@]}"; do
  state="$(docker inspect --format '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$bot")"
  echo "bot $bot: $state"
  [[ $state == running/healthy || $state == exited/* ]] || failed=1
done
exit "$failed"
