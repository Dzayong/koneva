#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/personal-common.sh"
source "$(dirname -- "${BASH_SOURCE[0]}")/backup-retention.sh"
backup_retention_mode "$@"
personal_load
personal_lock
umask 077
RETENTION_DAYS=${RETENTION_DAYS:-30}
backup_retention_validate "$BACKUP_DIR" "$RETENTION_DAYS" personal
mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="$(mktemp -d "$BACKUP_DIR/.incomplete-$stamp-XXXXXX")"
mapfile -t writers < <("${COMPOSE[@]}" ps --status running -q api-gateway device-manager dashboard)
mapfile -t bots < <(personal_bot_ids)
resume() {
  status=$?
  if ((${#writers[@]} + ${#bots[@]})); then docker start "${writers[@]}" "${bots[@]}" >/dev/null || status=1; fi
  if ((status)); then echo "Backup failed; partial files retained at $backup" >&2; fi
  exit "$status"
}
trap resume EXIT
# Quiesce writers so DB, queue snapshot and sessions describe the same pause.
if ((${#writers[@]} + ${#bots[@]})); then docker stop --time 30 "${writers[@]}" "${bots[@]}" >/dev/null; fi
"${COMPOSE[@]}" exec -T postgres sh -ec 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl' | gzip > "$backup/postgres.sql.gz"
# SYNC creates a completed RDB, no blind sleeps or stale BGSAVE file copies.
"${COMPOSE[@]}" exec -T redis sh -ec 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --rdb /data/personal-backup.rdb' >/dev/null
redis_container="$("${COMPOSE[@]}" ps -q redis)"
docker cp "$redis_container:/data/personal-backup.rdb" "$backup/redis.rdb"
tar -C "$SESSION_HOST_PATH" -czf "$backup/sessions.tar.gz" .
gzip -t "$backup/postgres.sql.gz"
tar -tzf "$backup/sessions.tar.gz" >/dev/null
"${COMPOSE[@]}" exec -T redis redis-check-rdb /data/personal-backup.rdb >/dev/null
cp "$PERSONAL_ENV_FILE" "$backup/environment.env"
git -C "$PERSONAL_ROOT" rev-parse HEAD > "$backup/revision.txt"
(cd "$backup" && sha256sum postgres.sql.gz redis.rdb sessions.tar.gz environment.env revision.txt > SHA256SUMS)
final="$BACKUP_DIR/backup-$stamp"
[[ ! -e $final ]] || die 'Backup timestamp collision'
mv "$backup" "$final"
echo "Backup complete: $final (includes secrets; keep private)."
backup_retention_report personal "$BACKUP_DIR"
