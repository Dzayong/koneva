#!/usr/bin/env bash
# Copies named secrets from a protected 0600 file into individual per-secret files, for Docker Compose's
# file-based `secrets:` mount (each service that declares `secrets: [name]` sees it read-only at
# /run/secrets/<name> inside the container — this works in plain `docker compose`, not just Swarm).
#
# Safety rules this script enforces:
#   - Only a name on the ALLOWLIST below may be requested; anything else is refused.
#   - The source file is never `source`d or `eval`'d — only the one matching "NAME=value" line is read.
#   - The secret value is never printed to stdout/stderr, never placed in a log line, and never passed as
#     a command-line argument to any external process (only written via output redirection / stdin).
#   - `set -x` is never enabled here, and this script refuses to run if the caller's shell already has
#     xtrace on (it could echo a command containing the value to the terminal/log).
#   - Fails closed: any missing/wrong-permission file, unknown name, or empty value stops the whole run.
#
# Usage:
#   scripts/inject-secrets.sh --from <protected 0600 env file> --out <target dir> NAME [NAME...]
#
# Output: <target dir>/<NAME> for each requested secret, mode 0400, directory mode 0700. Reference them
# from docker-compose.*.yml like:
#   secrets:
#     db_password: { file: ./secrets-runtime/DB_PASSWORD }
#   services:
#     api-gateway: { secrets: [db_password] }
# and the app reads /run/secrets/db_password as a file, not an environment variable.
#
# Known limitation (documented, not silently worked around): this KONEVA codebase currently reads
# configuration only from process.env (src/shared/config.ts), so a value staged here still has to reach
# the container as an environment variable until config.ts gains a `*_FILE`-path fallback (not done by
# this script). Until then, whatever still goes through `environment:` in a compose file remains visible
# to anyone who can run `docker inspect` on that container or host — this script does not and cannot hide
# that; it only prevents the value from ever appearing in this script's own output, logs, or argv.
set -euo pipefail

if [[ $- == *x* ]]; then
  echo "Refusing to run: the calling shell already has xtrace (set -x) enabled, which could print a secret value to the terminal/log." >&2
  exit 1
fi

# Edit this list deliberately; it is the only thing standing between "any env var name" and a secret file.
ALLOWLIST=(
  DB_PASSWORD
  REDIS_PASSWORD
  JWT_SECRET
  ADMIN_API_KEY
  APP_DB_PASSWORD
  GMAIL_OAUTH_CLIENT_SECRET
  GMAIL_OAUTH_REFRESH_TOKEN
  DOKU_CLIENT_ID
  DOKU_SHARED_KEY
)

usage() { echo "Usage: $0 --from <protected 0600 env file> --out <target dir> NAME [NAME...]" >&2; exit 1; }

from_file="" out_dir="" names=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --from) from_file=${2:?--from needs a path}; shift 2 ;;
    --out) out_dir=${2:?--out needs a path}; shift 2 ;;
    -h|--help) usage ;;
    *) names+=("$1"); shift ;;
  esac
done
[[ -n "$from_file" && -n "$out_dir" && ${#names[@]} -gt 0 ]] || usage

is_allowed() { local want=$1 n; for n in "${ALLOWLIST[@]}"; do [[ "$n" == "$want" ]] && return 0; done; return 1; }
for name in "${names[@]}"; do
  [[ "$name" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "Refusing: \"$name\" is not a valid secret name." >&2; exit 1; }
  is_allowed "$name" || { echo "Refusing: \"$name\" is not on the allowlist (edit ALLOWLIST in this script to add it deliberately)." >&2; exit 1; }
done

# The source file must be a real, non-symlink file owned by us, mode 0600 or stricter — the same checks
# scripts/ensure-personal-runtime-db-secret.py applies to the private personal env file.
[[ -e "$from_file" ]] || { echo "Refusing: \"$from_file\" does not exist." >&2; exit 1; }
[[ ! -L "$from_file" ]] || { echo "Refusing: \"$from_file\" is a symlink, not a regular file." >&2; exit 1; }
[[ -f "$from_file" ]] || { echo "Refusing: \"$from_file\" is not a regular file." >&2; exit 1; }
perm=$(stat -c '%a' "$from_file" 2>/dev/null || stat -f '%Lp' "$from_file")
[[ "$perm" == "600" || "$perm" == "400" ]] || { echo "Refusing: \"$from_file\" must be mode 0600 or 0400 (found $perm)." >&2; exit 1; }

umask 077
mkdir -p "$out_dir"
chmod 700 "$out_dir"

for name in "${names[@]}"; do
  # Exactly one "NAME=value" line, read with grep/sed only — the file as a whole is never sourced or eval'd.
  line_count=$(grep -c -E "^${name}=" -- "$from_file" || true)
  [[ "$line_count" == "1" ]] || { echo "Refusing: \"$from_file\" has $line_count line(s) matching ^${name}=, expected exactly 1." >&2; exit 1; }
  value=$(sed -n "s/^${name}=//p" -- "$from_file")
  value=${value%$'\r'}
  # Strip one layer of matching quotes, same convention as the rest of this repo's env files.
  if [[ ( "${value:0:1}" == '"' && "${value: -1}" == '"' ) || ( "${value:0:1}" == "'" && "${value: -1}" == "'" ) ]]; then
    value=${value:1:-1}
  fi
  [[ -n "$value" ]] || { echo "Refusing: \"$name\" is present but empty in \"$from_file\"." >&2; exit 1; }
  dest="$out_dir/$name"
  tmp=$(mktemp "$out_dir/.${name}.XXXXXX")
  printf '%s' "$value" > "$tmp"
  chmod 400 "$tmp"
  mv -f "$tmp" "$dest"
  unset value tmp
done

echo "Wrote ${#names[@]} secret file(s) to $out_dir (mode 400 each; values were not printed)." >&2
