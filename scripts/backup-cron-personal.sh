#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/personal-common.sh"
personal_load
[[ ${BACKUP_ENABLED:-true} == true ]] || die 'BACKUP_ENABLED is false.'
mkdir -p "$PERSONAL_ROOT/data/personal"
# Print a reviewable crontab line; do not replace the user's crontab.
printf "%s PERSONAL_ENV_FILE='%s' /bin/bash '%s/scripts/backup-personal.sh' >> '%s/data/personal/backup.log' 2>&1\n" \
  "${BACKUP_SCHEDULE:-0 3 * * *}" "$PERSONAL_ENV_FILE" "$PERSONAL_ROOT" "$PERSONAL_ROOT"
