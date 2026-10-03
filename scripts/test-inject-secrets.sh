#!/usr/bin/env bash
# Exercises scripts/inject-secrets.sh against synthetic fixtures only (never a real secret). Asserts the
# happy path copies the exact value into a 0400 file, every guard refuses its bad input, and the value
# never appears in this script's own captured stdout/stderr.
set -euo pipefail
cd "$(dirname "$0")/.."
SCRIPT=scripts/inject-secrets.sh
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
fail=0
assert() { if [[ "$1" == "$2" ]]; then echo "ok   - $3"; else echo "FAIL - $3 (expected [$2], got [$1])"; fail=1; fi; }
assert_contains() { if [[ "$1" == *"$2"* ]]; then echo "ok   - $3"; else echo "FAIL - $3 (expected to contain [$2])"; fail=1; fi; }

SYN_DB="synthetic-db-password-$RANDOM-not-real"
SYN_REDIS="synthetic-redis-password-$RANDOM-not-real"
printf 'DB_PASSWORD=%s\nREDIS_PASSWORD=%s\nNOT_ALLOWLISTED=irrelevant\n' "$SYN_DB" "$SYN_REDIS" > "$WORK/protected.env"
chmod 600 "$WORK/protected.env"

echo "== happy path: allowlisted names, correct permissions =="
out=$(bash "$SCRIPT" --from "$WORK/protected.env" --out "$WORK/out" DB_PASSWORD REDIS_PASSWORD 2>"$WORK/stderr.log" 1>"$WORK/stdout.log"; echo $?)
assert "$out" "0" "exits 0"
assert "$(cat "$WORK/out/DB_PASSWORD")" "$SYN_DB" "DB_PASSWORD file content matches the synthetic value"
assert "$(cat "$WORK/out/REDIS_PASSWORD")" "$SYN_REDIS" "REDIS_PASSWORD file content matches the synthetic value"
assert "$(stat -c '%a' "$WORK/out")" "700" "output directory is mode 700"
assert "$(stat -c '%a' "$WORK/out/DB_PASSWORD")" "400" "secret file is mode 400"
assert "$(cat "$WORK/stdout.log")" "" "stdout is empty"
if grep -qF -- "$SYN_DB" "$WORK/stdout.log" "$WORK/stderr.log" 2>/dev/null; then
  echo "FAIL - the secret value leaked into stdout/stderr"; fail=1
else
  echo "ok   - the secret value never appears in stdout/stderr"
fi

echo "== refuses a name not on the allowlist =="
set +e
err=$(bash "$SCRIPT" --from "$WORK/protected.env" --out "$WORK/out2" NOT_ALLOWLISTED 2>&1); code=$?
set -e
assert "$code" "1" "exits non-zero"
assert_contains "$err" "not on the allowlist" "explains why"
[[ -d "$WORK/out2" ]] && { echo "FAIL - out2 should not have been created"; fail=1; } || echo "ok   - no file written for a refused name"

echo "== refuses a source file that is not 0600/0400 =="
cp "$WORK/protected.env" "$WORK/loose.env"; chmod 644 "$WORK/loose.env"
set +e
err=$(bash "$SCRIPT" --from "$WORK/loose.env" --out "$WORK/out3" DB_PASSWORD 2>&1); code=$?
set -e
assert "$code" "1" "exits non-zero"
assert_contains "$err" "must be mode 0600" "explains why"

echo "== refuses a symlinked source file =="
ln -s "$WORK/protected.env" "$WORK/link.env"
set +e
err=$(bash "$SCRIPT" --from "$WORK/link.env" --out "$WORK/out4" DB_PASSWORD 2>&1); code=$?
set -e
assert "$code" "1" "exits non-zero"
assert_contains "$err" "symlink" "explains why"

echo "== refuses a name missing from the file =="
set +e
err=$(bash "$SCRIPT" --from "$WORK/protected.env" --out "$WORK/out5" JWT_SECRET 2>&1); code=$?
set -e
assert "$code" "1" "exits non-zero"
assert_contains "$err" "expected exactly 1" "explains why"

echo "== refuses an empty value =="
printf 'JWT_SECRET=\n' > "$WORK/empty.env"; chmod 600 "$WORK/empty.env"
set +e
err=$(bash "$SCRIPT" --from "$WORK/empty.env" --out "$WORK/out6" JWT_SECRET 2>&1); code=$?
set -e
assert "$code" "1" "exits non-zero"
assert_contains "$err" "empty" "explains why"

echo "== refuses to run with xtrace already enabled =="
set +e
err=$(bash -x "$SCRIPT" --from "$WORK/protected.env" --out "$WORK/out7" DB_PASSWORD 2>&1); code=$?
set -e
assert "$code" "1" "exits non-zero"
assert_contains "$err" "xtrace" "explains why"

if [[ "$fail" == "0" ]]; then echo "ALL PASS"; else echo "SOME FAILED"; fi
exit "$fail"
