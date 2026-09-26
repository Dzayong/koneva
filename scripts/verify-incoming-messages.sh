#!/usr/bin/env bash
set -Eeuo pipefail

POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-docker-postgres-1}"
POSTGRES_USER="${POSTGRES_USER:-wagateway}"
POSTGRES_DB="${POSTGRES_DB:-wagateway}"
BOT_CONTAINER="${BOT_CONTAINER:-}"
LIMIT="${LIMIT:-10}"

command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }
[[ "$LIMIT" =~ ^[1-9][0-9]*$ ]] || { echo "LIMIT must be a positive integer" >&2; exit 2; }
docker inspect "$POSTGRES_CONTAINER" >/dev/null 2>&1 || {
  echo "PostgreSQL container not found: $POSTGRES_CONTAINER" >&2
  exit 1
}

psql_cmd=(docker exec "$POSTGRES_CONTAINER" psql -X -v ON_ERROR_STOP=1 \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" -P pager=off)

echo "Checking inbound-message columns and status constraint..."
for column in direction from_number; do
  found="$("${psql_cmd[@]}" -Atc \
    "SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='messages' AND column_name='$column';")"
  [[ "$found" == "1" ]] || { echo "Missing messages.$column; run npm run migrate" >&2; exit 1; }
done

echo "Recent inbound messages:"
"${psql_cmd[@]}" -c \
  "SELECT id, device_key, from_number, content, type, status, whatsapp_message_id, created_at
   FROM messages WHERE direction = 'inbound'
   ORDER BY created_at DESC LIMIT $LIMIT;"

count="$("${psql_cmd[@]}" -Atc "SELECT COUNT(*) FROM messages WHERE direction='inbound';")"
if [[ "$count" == "0" ]]; then
  echo "WARNING: no inbound message is stored yet." >&2
  echo "Send a WhatsApp message to an online gateway number, then rerun this script." >&2
fi

if [[ -n "$BOT_CONTAINER" ]]; then
  echo "Recent incoming-message logs from $BOT_CONTAINER:"
  docker logs --tail 300 "$BOT_CONTAINER" 2>&1 \
    | grep -E 'messages\.upsert|Incoming WhatsApp message|Failed to save incoming' || true
fi

echo "Incoming-message verification completed."
