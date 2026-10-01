#!/usr/bin/env bash
# Disposable PostgreSQL only. No production env file, host volume, bot, or payment gateway.
set -euo pipefail
cd "$(dirname "$0")/.."
operator_test_container="koneva-operator-test-$$"
operator_test_redis_container=""
cleanup() {
  docker rm -f "$operator_test_container" >/dev/null 2>&1 || true
  [[ -z "$operator_test_redis_container" ]] || docker rm -f "$operator_test_redis_container" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker run --rm -d --name "$operator_test_container" --label koneva.purpose=operator-isolated-test \
  -e POSTGRES_PASSWORD=operator_test_only -e POSTGRES_DB=operator_test \
  -p 127.0.0.1::5432 postgres:15-alpine >/dev/null
for attempt in {1..30}; do
  if docker exec "$operator_test_container" pg_isready -U postgres -d operator_test >/dev/null 2>&1; then break; fi
  sleep 1
done
operator_test_binding=$(docker port "$operator_test_container" 5432/tcp)
export DATABASE_URL="postgres://postgres:operator_test_only@${operator_test_binding}/operator_test"
export NODE_ENV=test ADMIN_API_KEY=operator-test-admin JWT_SECRET=operator-test-jwt
if [[ "${OPERATOR_TEST_REDIS:-0}" == "1" ]]; then
  operator_test_redis_container="koneva-operator-redis-test-$$"
  docker run --rm -d --name "$operator_test_redis_container" --label koneva.purpose=operator-isolated-test \
    -p 127.0.0.1::6379 redis:7-alpine redis-server --save '' --appendonly no >/dev/null
  for attempt in {1..30}; do
    if docker exec "$operator_test_redis_container" redis-cli ping >/dev/null 2>&1; then break; fi
    sleep 1
  done
  operator_test_redis_binding=$(docker port "$operator_test_redis_container" 6379/tcp)
  export REDIS_URL="redis://${operator_test_redis_binding}"
else
  export REDIS_URL=redis://127.0.0.1:1
fi
export OPERATOR_STACK_TEST=1 OPERATOR_ENABLED=false
export DEVICE_MANAGER_URL=http://127.0.0.1:18093 # fake manager, started only by roles-access.test.ts
export OPERATOR_INSECURE_DEV_COOKIES=false OPERATOR_COOKIE_SECURE=true OPERATOR_COOKIE_NAME=__Host-koneva_op
export DOTENV_CONFIG_QUIET=true
# Tests never send email. EMAIL_TRANSPORT and every Gmail variable are set explicitly, because shared/config loads .env
# (dotenv does not override variables that already exist, not even empty ones). Individual tests switch to the file outbox themselves.
export EMAIL_TRANSPORT=none GMAIL_OAUTH_CLIENT_ID= GMAIL_OAUTH_CLIENT_SECRET= GMAIL_OAUTH_REFRESH_TOKEN= GMAIL_SENDER_EMAIL= DEV_EMAIL_OUTBOX_FILE=
# One synthetic MFA key for the whole run: the key guard compares against every secret stored in the shared disposable DB.
OPERATOR_MFA_ENC_KEY=$(head -c 32 /dev/urandom | base64); export OPERATOR_MFA_ENC_KEY
./node_modules/.bin/tsc --noEmit
if [[ "${1:-}" == '--all' ]]; then
  node --require ts-node/register --test --test-concurrency=1 src/**/*.test.ts src/api-gateway/services/mailer.test.ts src/api-gateway/services/recipient-consent.test.ts
else
  node --require ts-node/register --test --test-concurrency=1 src/api-gateway/operator.test.ts src/api-gateway/operator-core.test.ts src/api-gateway/operator-mfa.test.ts src/api-gateway/operator-hardening.test.ts src/api-gateway/roles-access.test.ts src/api-gateway/otp-limits.test.ts src/api-gateway/operator-alerts.test.ts src/api-gateway/team.test.ts src/api-gateway/billing.test.ts src/shared/permissions.test.ts
fi
