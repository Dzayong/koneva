#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/personal-common.sh"
personal_load
personal_lock
if [[ ${1:-} == --pull ]]; then
  [[ -z $(git -C "$PERSONAL_ROOT" status --porcelain) ]] || die 'Commit/stash local changes before --pull.'
  git -C "$PERSONAL_ROOT" pull --ff-only
elif [[ $# -gt 0 ]]; then die 'Usage: update-personal.sh [--pull]'; fi
"$PERSONAL_ROOT/scripts/backup-personal.sh"
"$PERSONAL_ROOT/scripts/start-personal.sh"
# Recreate only bots labelled for this personal network, preserving sessions.
"${COMPOSE[@]}" exec -T device-manager node dist/scripts/refresh-personal-bots.js
echo 'Update complete. Existing bot sessions retained; use make monitor to check reconnection.'
