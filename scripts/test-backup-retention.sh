#!/usr/bin/env bash
set -Eeuo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
source "$ROOT/scripts/backup-retention.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
[[ $BACKUP_RETENTION_REPORT_DAYS == 90 ]] || fail 'aggregate report retention must be 90 days and separate from backup retention'
stale=$(date -u -d '31 days ago' +%Y%m%dT%H%M%SZ)
fresh=$(date -u +%Y%m%dT%H%M%SZ)
cutoff=$(date -u -d '30 days ago' +%FT%TZ)
mkdir -p "$tmp/k8s" "$tmp/personal"

# Default is dry-run: report an expired synthetic archive without deleting it.
touch "$tmp/k8s/wa-gateway-k8s-$stale.tar.gz" "$tmp/k8s/wa-gateway-k8s-$stale.tar.gz.sha256"
touch "$tmp/k8s/wa-gateway-k8s-$fresh.tar.gz" "$tmp/k8s/wa-gateway-k8s-$fresh.tar.gz.sha256"
CLOUD_PROVIDER=none
unset BACKUP_RETENTION_EXECUTE_ENABLED BACKUP_LOCAL_PURGE_VERIFIED || true
backup_retention_mode
backup_retention_validate "$tmp/k8s" 30 k8s
report=$(backup_retention_report k8s "$tmp/k8s")
[[ $report == *'eligible_snapshots=1 incomplete_expired_snapshots=0'* ]] || fail 'dry-run must count one old complete snapshot'
[[ -f $tmp/k8s/wa-gateway-k8s-$stale.tar.gz ]] || fail 'dry-run removed an archive'
[[ -f $tmp/k8s/wa-gateway-k8s-$fresh.tar.gz ]] || fail 'dry-run removed a fresh archive'
report_file=$(find "$tmp/k8s/.retention-reports" -maxdepth 1 -type f -name 'backup-retention-*.jsonl' -print -quit)
[[ -n $report_file ]] || fail 'dry-run did not persist a report'
[[ $(stat -c '%a' "$tmp/k8s/.retention-reports") == 700 ]] || fail 'report directory must be mode 700'
[[ $(stat -c '%a' "$report_file") == 600 ]] || fail 'report file must be mode 600'
[[ $(stat -c '%a' "$tmp/k8s/.retention-reports/.append.lock") == 600 ]] || fail 'append lock must be mode 600'
line_count=$(wc -l < "$report_file")
[[ $line_count == 1 ]] || fail 'daily report must contain one complete JSONL record'
[[ $(cat "$report_file") != *"$tmp"* ]] || fail 'report leaked a storage path'
[[ $(cat "$report_file") != *"wa-gateway-k8s-$stale"* ]] || fail 'report leaked a backup filename'
node - "$report_file" "$cutoff" <<'NODE'
const fs = require('node:fs');
const records = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map(JSON.parse);
if (records.length !== 1) throw new Error('expected one report record');
const r = records[0];
const expected = ['timestamp_utc','job','source','cutoff_utc','candidate_count','affected_count','incomplete_count','mode','status'];
if (Object.keys(r).sort().join(',') !== expected.sort().join(',')) throw new Error('unexpected report fields');
if (r.job !== 'backup_rotation_30d' || r.source !== 'k8s' || Math.abs(Date.parse(r.cutoff_utc) - Date.parse(process.argv[3])) > 120_000) throw new Error('wrong report metadata');
if (r.candidate_count !== 1 || r.affected_count !== 0 || r.incomplete_count !== 0 || r.mode !== 'dry-run' || r.status !== 'succeeded') throw new Error('wrong dry-run counts/status');
if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(r.timestamp_utc)) throw new Error('timestamp is not UTC');
NODE

# Concurrent writers must leave only complete JSONL records under the private lock.
for _ in $(seq 1 20); do
  (backup_retention_write_report "$tmp/concurrent" k8s dry-run succeeded "$cutoff" 0 0 0) &
done
wait
concurrent_file=$(find "$tmp/concurrent/.retention-reports" -maxdepth 1 -type f -name 'backup-retention-*.jsonl' -print -quit)
[[ $(wc -l < "$concurrent_file") == 20 ]] || fail 'concurrent reports were lost or interleaved'
[[ $(stat -c '%a' "$concurrent_file") == 600 ]] || fail 'concurrent report file permissions changed'
node - "$concurrent_file" <<'NODE'
const fs = require('node:fs');
const rows = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map(JSON.parse);
if (rows.length !== 20 || rows.some(r => r.job !== 'backup_rotation_30d')) throw new Error('concurrent JSONL append was not atomic');
NODE

# An execute request without either gate is blocked and durably recorded.
backup_retention_mode --execute
if backup_retention_validate "$tmp/k8s" 30 k8s 2>/dev/null; then fail 'execute mode passed without gates'; fi
[[ -f $tmp/k8s/wa-gateway-k8s-$stale.tar.gz ]] || fail 'blocked execute removed an archive'
node - "$report_file" <<'NODE'
const fs = require('node:fs');
const records = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map(JSON.parse);
const r = records.at(-1);
if (r.job !== 'backup_rotation_30d' || r.mode !== 'execute' || r.status !== 'blocked' || r.affected_count !== 0) throw new Error('blocked execute was not recorded');
NODE
BACKUP_RETENTION_EXECUTE_ENABLED=true
unset BACKUP_LOCAL_PURGE_VERIFIED || true
if backup_retention_validate "$tmp/k8s" 30 k8s 2>/dev/null; then fail 'execute passed without local purge verification gate'; fi
[[ -f $tmp/k8s/wa-gateway-k8s-$stale.tar.gz ]] || fail 'unverified local-purge gate removed an archive'
node - "$report_file" <<'NODE'
const fs = require('node:fs');
const records = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map(JSON.parse);
const r = records.at(-1);
if (r.mode !== 'execute' || r.status !== 'blocked' || r.candidate_count !== 0 || r.affected_count !== 0) throw new Error('local-purge gate denial was not recorded');
NODE

# Incomplete personal snapshots block rotation; report only counts, never paths.
partial=$(date -u -d '32 days ago' +%Y%m%dT%H%M%SZ)
mkdir -p "$tmp/personal/backup-$stale" "$tmp/personal/backup-$fresh" "$tmp/personal/backup-$partial" "$tmp/personal/.incomplete-$stale-abc123"
touch "$tmp/personal/backup-$stale/SHA256SUMS" "$tmp/personal/backup-$fresh/SHA256SUMS"
backup_retention_mode
backup_retention_validate "$tmp/personal" 30 personal
if report=$(backup_retention_report personal "$tmp/personal"); then fail 'expired partial snapshot should fail closed'; fi
[[ $report == *'eligible_snapshots=1 incomplete_expired_snapshots=2'* ]] || fail 'personal report must count incomplete snapshots'
[[ -d $tmp/personal/backup-$stale && -d $tmp/personal/.incomplete-$stale-abc123 ]] || fail 'dry-run changed personal snapshots'
personal_report=$(find "$tmp/personal/.retention-reports" -maxdepth 1 -type f -name 'backup-retention-*.jsonl' -print -quit)
[[ $(stat -c '%a' "$personal_report") == 600 ]] || fail 'personal report must be mode 600'
node - "$personal_report" <<'NODE'
const fs = require('node:fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').trim());
if (r.job !== 'backup_rotation_30d' || r.source !== 'personal' || r.status !== 'blocked' || r.candidate_count !== 1 || r.incomplete_count !== 2 || r.affected_count !== 0) throw new Error('wrong personal blocked report');
NODE

# Cloud and non-30-day settings fail closed before any storage work.
CLOUD_PROVIDER=s3
backup_retention_mode
if backup_retention_validate "$tmp/k8s" 30 k8s 2>/dev/null; then fail 'unsafe cloud provider was accepted'; fi
CLOUD_PROVIDER=none
if backup_retention_validate "$tmp/k8s" 7 k8s 2>/dev/null; then fail 'non-policy retention period was accepted'; fi

echo 'backup retention tests passed (synthetic local fixtures; no backup deletion)'
