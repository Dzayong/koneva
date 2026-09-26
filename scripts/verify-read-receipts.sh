#!/usr/bin/env bash
set -Eeuo pipefail

POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-docker-postgres-1}"
POSTGRES_USER="${POSTGRES_USER:-wagateway}"
POSTGRES_DB="${POSTGRES_DB:-wagateway}"
LIMIT="${LIMIT:-10}"

command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }
docker inspect "$POSTGRES_CONTAINER" >/dev/null 2>&1 || {
  echo "PostgreSQL container not found: $POSTGRES_CONTAINER" >&2
  exit 1
}
[[ "$LIMIT" =~ ^[1-9][0-9]*$ ]] || { echo "LIMIT must be a positive integer" >&2; exit 2; }

psql_cmd=(docker exec "$POSTGRES_CONTAINER" psql -X -v ON_ERROR_STOP=1 \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" -P pager=off)

echo "Checking receipt columns..."
columns="$("${psql_cmd[@]}" -Atc \
  "SELECT column_name FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'messages'
     AND column_name IN ('sent_at', 'delivered_at', 'read_at', 'whatsapp_message_id')
   ORDER BY column_name;")"
for required in delivered_at read_at sent_at whatsapp_message_id; do
  grep -qx "$required" <<<"$columns" || { echo "Missing messages.$required" >&2; exit 1; }
done

echo "Recent trackable outbound messages:"
"${psql_cmd[@]}" -c \
  "SELECT id, device_key, status, whatsapp_message_id, sent_at, delivered_at, read_at
   FROM messages
   WHERE whatsapp_message_id IS NOT NULL
   ORDER BY created_at DESC LIMIT $LIMIT;"

echo "Receipt summary:"
"${psql_cmd[@]}" -c \
  "SELECT
     COUNT(*) FILTER (WHERE whatsapp_message_id IS NOT NULL) AS trackable,
     COUNT(*) FILTER (WHERE delivered_at IS NOT NULL) AS delivered,
     COUNT(*) FILTER (WHERE read_at IS NOT NULL) AS read
   FROM messages;"

trackable="$("${psql_cmd[@]}" -Atc \
  "SELECT COUNT(*) FROM messages WHERE whatsapp_message_id IS NOT NULL;")"
if [[ "$trackable" == "0" ]]; then
  echo "WARNING: no message has whatsapp_message_id; live receipts cannot match a database row." >&2
  echo "Send a message through an online bot, then run this script again." >&2
fi

echo "Read-receipt database verification completed."
