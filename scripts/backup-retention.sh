#!/usr/bin/env bash
# Shared, fail-closed local backup rotation. Sourced only by backup scripts.
BACKUP_RETENTION_REPORT_DAYS=90

backup_retention_mode_name() {
  [[ ${BACKUP_RETENTION_EXECUTE:-0} == 1 ]] && echo execute || echo dry-run
}

backup_retention_write_report() {
  local root=${1%/} source=$2 mode=$3 status=$4 cutoff=$5 candidates=$6 affected=$7 incomplete=$8
  local report_dir report_file day line report_cutoff old_file old_day
  [[ $root == /* && $root != / && ! -L $root ]] || return 2
  [[ $source == k8s || $source == personal ]] || return 2
  [[ $mode == dry-run || $mode == execute ]] || return 2
  [[ $status == succeeded || $status == blocked || $status == failed ]] || return 2
  [[ $cutoff =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || return 2
  [[ $candidates =~ ^[0-9]+$ && $affected =~ ^[0-9]+$ && $incomplete =~ ^[0-9]+$ ]] || return 2
  command -v sync >/dev/null 2>&1 || { echo 'sync is required to persist retention reports.' >&2; return 2; }

  umask 077
  mkdir -m 700 -p -- "$root/.retention-reports"
  report_dir="$root/.retention-reports"
  [[ -d $report_dir && ! -L $report_dir ]] || return 2
  chmod 700 -- "$report_dir"
  [[ $(stat -c '%u' -- "$report_dir") == "$EUID" ]] || return 2
  [[ ! -L $report_dir/.append.lock ]] || return 2
  exec 9>"$report_dir/.append.lock"
  chmod 600 -- "$report_dir/.append.lock"
  flock -x 9

  day=$(date -u +%Y%m%d)
  report_file="$report_dir/backup-retention-$day.jsonl"
  [[ ! -L $report_file ]] || return 2
  if [[ ! -e $report_file ]]; then
    (umask 077; set -o noclobber; : > "$report_file") 2>/dev/null || [[ -f $report_file && ! -L $report_file ]]
  fi
  [[ -f $report_file && ! -L $report_file ]] || return 2
  chmod 600 -- "$report_file"
  line=$(printf '{"timestamp_utc":"%s","job":"backup_rotation_30d","source":"%s","cutoff_utc":"%s","candidate_count":%s,"affected_count":%s,"incomplete_count":%s,"mode":"%s","status":"%s"}' \
    "$(date -u +%FT%TZ)" "$source" "$cutoff" "$candidates" "$affected" "$incomplete" "$mode" "$status")
  # The private lock serializes writers, making each newline-terminated record
  # an indivisible append from the perspective of concurrent script runs.
  printf '%s\n' "$line" >> "$report_file"
  sync -f "$report_file"

  # These aggregate-only reports live outside snapshot name patterns and have
  # a separate 90-day policy; pruning them cannot affect 30-day backup data.
  report_cutoff=$(date -u -d "$BACKUP_RETENTION_REPORT_DAYS days ago" +%Y%m%d)
  shopt -s nullglob
  for old_file in "$report_dir"/backup-retention-*.jsonl; do
    [[ $old_file != "$report_file" ]] || continue
    old_day=${old_file##*/backup-retention-}; old_day=${old_day%.jsonl}
    [[ $old_day =~ ^[0-9]{8}$ && $old_day < $report_cutoff ]] || continue
    [[ -f $old_file && ! -L $old_file ]] || continue
    rm -- "$old_file"
  done
  shopt -u nullglob
}

backup_retention_mode() {
  if (($# == 0)); then BACKUP_RETENTION_EXECUTE=0
  elif (($# == 1)) && [[ $1 == --execute ]]; then BACKUP_RETENTION_EXECUTE=1
  else echo 'Usage: backup script [--execute]' >&2; return 2
  fi
}

backup_retention_validate() {
  local root=$1 days=$2 job=$3 provider=${CLOUD_PROVIDER:-none} cutoff mode
  root=${root%/}
  cutoff=$(date -u -d '30 days ago' +%FT%TZ)
  mode=$(backup_retention_mode_name)
  if [[ $days != 30 ]]; then
    echo 'Backup retention is fixed at 30 days.' >&2
    backup_retention_write_report "$root" "$job" "$mode" blocked "$cutoff" 0 0 0 || true
    return 2
  fi
  # No cloud provider has an independently verified purge policy yet. In
  # particular, an object delete marker is not proof that versions, replicas,
  # holds, or soft-deleted copies are gone.
  if [[ $provider != none ]]; then
    echo "Refusing CLOUD_PROVIDER=$provider: permanent purge of versions, replicas, holds, and soft-deleted copies is not verified." >&2
    backup_retention_write_report "$root" "$job" "$mode" blocked "$cutoff" 0 0 0 || true
    return 2
  fi
  [[ $root == /* && $root != / && ! -L $root ]] || {
    echo 'Backup root must be an absolute, dedicated, non-symlink directory.' >&2; return 2;
  }
  if (( BACKUP_RETENTION_EXECUTE )); then
    if [[ ${BACKUP_RETENTION_EXECUTE_ENABLED:-false} != true ]]; then
      echo 'Deletion disabled: set BACKUP_RETENTION_EXECUTE_ENABLED=true after reviewing dry-run reports.' >&2
      backup_retention_write_report "$root" "$job" execute blocked "$cutoff" 0 0 0 || true
      return 2
    fi
    if [[ ${BACKUP_LOCAL_PURGE_VERIFIED:-false} != true ]]; then
      echo 'Deletion disabled: verify the backing volume has no snapshots/replicas beyond 30 days, then set BACKUP_LOCAL_PURGE_VERIFIED=true.' >&2
      backup_retention_write_report "$root" "$job" execute blocked "$cutoff" 0 0 0 || true
      return 2
    fi
  fi
}

backup_retention_cutoff_epoch() {
  date -u -d '30 days ago' +%s
}

backup_retention_snapshot_epoch() {
  local stamp=$1
  [[ $stamp =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || return 1
  date -u -d "${stamp:0:8} ${stamp:9:2}:${stamp:11:2}:${stamp:13:2} UTC" +%s 2>/dev/null
}

backup_retention_report() {
  local kind=$1 root=${2%/} cutoff cutoff_iso now path base stamp epoch incomplete_count=0 affected_count=0 status=succeeded
  local -a candidates=()
  cutoff=$(backup_retention_cutoff_epoch)
  now=$(date -u +%FT%TZ)
  cutoff_iso=$(date -u -d "@$cutoff" +%FT%TZ)
  shopt -s nullglob
  if [[ $kind == k8s ]]; then
    for path in "$root"/wa-gateway-k8s-*.tar.gz; do
      base=${path##*/}; stamp=${base#wa-gateway-k8s-}; stamp=${stamp%.tar.gz}
      epoch=$(backup_retention_snapshot_epoch "$stamp") || continue
      (( epoch < cutoff )) || continue
      if [[ -f $path.sha256 && ! -L $path && ! -L $path.sha256 ]]; then candidates+=("$path")
      else ((incomplete_count+=1)); fi
    done
  elif [[ $kind == personal ]]; then
    for path in "$root"/backup-*; do
      [[ -d $path && ! -L $path ]] || continue
      base=${path##*/}; stamp=${base#backup-}
      epoch=$(backup_retention_snapshot_epoch "$stamp") || continue
      (( epoch < cutoff )) || continue
      if [[ -f $path/SHA256SUMS ]]; then candidates+=("$path")
      else ((incomplete_count+=1)); fi
    done
    # Failed personal backups use this private temporary naming convention.
    # They are not safe automatic deletion candidates, but must prevent a
    # false claim that all expired backup material has rotated out.
    for path in "$root"/.incomplete-*; do
      [[ -d $path && ! -L $path ]] || continue
      base=${path##*/}; stamp=${base#.incomplete-}; stamp=${stamp%-*}
      epoch=$(backup_retention_snapshot_epoch "$stamp") || continue
      (( epoch < cutoff )) && ((incomplete_count+=1))
    done
  else
    echo "Unknown backup kind: $kind" >&2; return 2
  fi
  shopt -u nullglob

  printf 'backup_retention_report_at=%s\n' "$now"
  printf 'backup_kind=%s retention_days=30 cutoff_utc=%s mode=%s report_retention_days=%s\n' "$kind" "$cutoff_iso" "$(backup_retention_mode_name)" "$BACKUP_RETENTION_REPORT_DAYS"
  printf 'eligible_snapshots=%d incomplete_expired_snapshots=%d\n' "${#candidates[@]}" "$incomplete_count"
  for path in "${candidates[@]}"; do printf 'candidate=%s\n' "${path##*/}"; done
  if (( incomplete_count )); then
    echo 'Retention incomplete: expired partial snapshots need operator review; no deletion was attempted.' >&2
    backup_retention_write_report "$root" "$kind" "$(backup_retention_mode_name)" blocked "$cutoff_iso" "${#candidates[@]}" 0 "$incomplete_count"
    return 1
  fi

  if (( BACKUP_RETENTION_EXECUTE )); then
    exec 8>"$root/.backup-retention.lock"
    if ! flock -n 8; then
      echo 'Another backup retention run is active.' >&2
      backup_retention_write_report "$root" "$kind" execute blocked "$cutoff_iso" "${#candidates[@]}" 0 0
      return 2
    fi
    for path in "${candidates[@]}"; do
      # Revalidate immediately before removal; candidates are only generated
      # from the exact controlled naming scheme above.
      if [[ ! $path == "$root"/* || -L $path ]]; then
        echo 'Unsafe backup candidate; aborting.' >&2
        backup_retention_write_report "$root" "$kind" execute failed "$cutoff_iso" "${#candidates[@]}" "$affected_count" 0
        return 2
      fi
      if [[ $kind == k8s ]]; then
        if [[ ! -f $path || ! -f $path.sha256 || -L $path.sha256 ]]; then
          echo 'Backup changed after report; aborting.' >&2
          backup_retention_write_report "$root" "$kind" execute failed "$cutoff_iso" "${#candidates[@]}" "$affected_count" 0
          return 2
        fi
        if ! rm -- "$path" "$path.sha256"; then
          backup_retention_write_report "$root" "$kind" execute failed "$cutoff_iso" "${#candidates[@]}" "$affected_count" 0
          return 1
        fi
      else
        if [[ ! -d $path || -L $path || ! -f $path/SHA256SUMS ]]; then
          echo 'Backup changed after report; aborting.' >&2
          backup_retention_write_report "$root" "$kind" execute failed "$cutoff_iso" "${#candidates[@]}" "$affected_count" 0
          return 2
        fi
        if ! rm -r -- "$path"; then
          backup_retention_write_report "$root" "$kind" execute failed "$cutoff_iso" "${#candidates[@]}" "$affected_count" 0
          return 1
        fi
      fi
      ((affected_count+=1))
      printf 'deleted=%s\n' "${path##*/}"
    done
  fi
  backup_retention_write_report "$root" "$kind" "$(backup_retention_mode_name)" "$status" "$cutoff_iso" "${#candidates[@]}" "$affected_count" 0
}
