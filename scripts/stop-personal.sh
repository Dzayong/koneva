#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/personal-common.sh"
personal_load
personal_lock
mapfile -t bots < <(personal_bot_ids)
if ((${#bots[@]})); then
  printf '%s\n' "${bots[@]}" >> "$PERSONAL_ROOT/data/personal/$PERSONAL_PROJECT.stopped-bots"
  docker stop --time 30 "${bots[@]}"
fi
"${COMPOSE[@]}" --profile with-nginx stop --timeout 30
echo 'Personal services stopped. Containers, network, volumes, and WhatsApp sessions are retained.'
