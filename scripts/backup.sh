#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
NAMESPACE=${K8S_NAMESPACE:-wa-gateway}
BACKUP_ROOT=${BACKUP_ROOT:-$PROJECT_ROOT/backups}
RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-7}
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT
mkdir -p "$BACKUP_ROOT" "$work_dir/sessions"

command -v kubectl >/dev/null 2>&1 || { echo "kubectl is required" >&2; exit 1; }

postgres_user=$(kubectl get secret wa-gateway-secrets -n "$NAMESPACE" -o jsonpath='{.data.POSTGRES_USER}' | base64 -d)
postgres_db=$(kubectl get secret wa-gateway-secrets -n "$NAMESPACE" -o jsonpath='{.data.POSTGRES_DB}' | base64 -d)
redis_password=$(kubectl get secret wa-gateway-secrets -n "$NAMESPACE" -o jsonpath='{.data.REDIS_PASSWORD}' | base64 -d)

kubectl exec -n "$NAMESPACE" postgres-0 -- \
  pg_dump --clean --if-exists --no-owner -U "$postgres_user" "$postgres_db" \
  | gzip > "$work_dir/postgres.sql.gz"

kubectl exec -n "$NAMESPACE" redis-0 -- sh -c \
  'REDISCLI_AUTH="$1" redis-cli BGSAVE >/dev/null; while [ "$(REDISCLI_AUTH="$1" redis-cli INFO persistence | tr -d "\r" | grep "rdb_bgsave_in_progress:1")" ]; do sleep 1; done' \
  sh "$redis_password"
kubectl cp "$NAMESPACE/redis-0:/data/dump.rdb" "$work_dir/redis.rdb"

while IFS= read -r pod; do
  [[ -z "$pod" ]] && continue
  kubectl exec -n "$NAMESPACE" "$pod" -- tar -C /app/sessions -czf - . \
    > "$work_dir/sessions/$pod.tar.gz"
done < <(kubectl get pods -n "$NAMESPACE" \
  -l app.kubernetes.io/component=bot -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}')

printf '{"created_at":"%s","namespace":"%s"}\n' "$(date -u +%FT%TZ)" "$NAMESPACE" \
  > "$work_dir/manifest.json"

archive="$BACKUP_ROOT/wa-gateway-k8s-$timestamp.tar.gz"
tar -C "$work_dir" -czf "$archive" .
sha256sum "$archive" > "$archive.sha256"
find "$BACKUP_ROOT" -type f -name 'wa-gateway-k8s-*' -mtime "+$RETENTION_DAYS" -delete

case "${CLOUD_PROVIDER:-none}" in
  s3)
    : "${S3_BUCKET:?Set S3_BUCKET}"
    command -v aws >/dev/null 2>&1 || { echo "AWS CLI is required" >&2; exit 1; }
    prefix=${BACKUP_PREFIX:-wa-gateway/backups}
    aws s3 cp "$archive" "s3://$S3_BUCKET/$prefix/$(basename "$archive")"
    aws s3 cp "$archive.sha256" "s3://$S3_BUCKET/$prefix/$(basename "$archive.sha256")"
    cutoff=$(date -u -d "$RETENTION_DAYS days ago" +%FT%TZ)
    while IFS= read -r key; do
      [[ -z "$key" || "$key" == None ]] || aws s3 rm "s3://$S3_BUCKET/$key"
    done < <(aws s3api list-objects-v2 --bucket "$S3_BUCKET" --prefix "$prefix/" \
      --query "Contents[?LastModified<=\`$cutoff\`].Key" --output text | tr '\t' '\n')
    ;;
  gcs)
    : "${GCS_BUCKET:?Set GCS_BUCKET}"
    command -v gsutil >/dev/null 2>&1 || { echo "gsutil is required" >&2; exit 1; }
    prefix=${BACKUP_PREFIX:-wa-gateway/backups}
    gsutil cp "$archive" "$archive.sha256" "gs://$GCS_BUCKET/$prefix/"
    cutoff_epoch=$(date -u -d "$RETENTION_DAYS days ago" +%s)
    gsutil ls -l "gs://$GCS_BUCKET/$prefix/**" | awk 'NF == 3 && $1 ~ /^[0-9]+$/ {print $2, $3}' | \
      while read -r created object; do
        [[ $(date -u -d "$created" +%s) -gt "$cutoff_epoch" ]] || gsutil rm "$object"
      done
    ;;
  none) ;;
  *) echo "CLOUD_PROVIDER must be none, s3, or gcs" >&2; exit 2 ;;
esac

echo "Backup completed: $archive"
