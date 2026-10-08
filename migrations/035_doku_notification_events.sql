-- Idempotency for inbound DOKU payment notifications (docs/DOKU_INTEGRATION_SPEC.md §4).
-- A notification is only ever applied once per DOKU Request-Id, even on a legitimate retry.
-- This is defense in depth: billing.markInvoicePaid() also refuses a non-'unpaid' invoice,
-- so a replay under a *different* Request-Id for the same invoice is still rejected there.
CREATE TABLE IF NOT EXISTS doku_notification_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id VARCHAR(128) NOT NULL UNIQUE,
  invoice_number VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS doku_notification_events_invoice_number_idx
  ON doku_notification_events (invoice_number);
