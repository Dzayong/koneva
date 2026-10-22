#!/usr/bin/env bash
# Sustained authenticated API + BullMQ worker test. It inherits the disposable
# PostgreSQL/Redis setup and fake WhatsApp transport from test-outbound-local.sh.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
OUTBOUND_SUSTAINED_TEST=1 bash scripts/test-outbound-local.sh
