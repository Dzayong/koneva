-- Move new PAYG top-ups to Duitku POP while retaining old DOKU history.
ALTER TABLE wallet_topups
  ADD COLUMN payment_provider VARCHAR(16) NOT NULL DEFAULT 'doku'
    CHECK (payment_provider IN ('doku','duitku')),
  ADD COLUMN provider_reference VARCHAR(100);

-- The owner confirmed old unpaid DOKU checkouts may be closed during this early test migration.
-- Keep their records for audit; a late DOKU callback cannot credit a void top-up.
UPDATE wallet_topups SET status='void'
  WHERE payment_provider='doku' AND status='unpaid';

ALTER TABLE wallet_topups ALTER COLUMN payment_provider SET DEFAULT 'duitku';
GRANT UPDATE(provider_reference) ON wallet_topups TO koneva_application;

CREATE TABLE duitku_callback_events (
  event_key CHAR(64) PRIMARY KEY,
  merchant_order_id VARCHAR(64) NOT NULL,
  amount_idr BIGINT NOT NULL CHECK (amount_idr > 0),
  result_code VARCHAR(8) NOT NULL,
  provider_reference VARCHAR(100),
  result_reason VARCHAR(32),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ
);
CREATE INDEX duitku_callback_order_idx ON duitku_callback_events(merchant_order_id, received_at DESC);
GRANT SELECT, INSERT ON duitku_callback_events TO koneva_application;
GRANT UPDATE(result_reason, applied_at) ON duitku_callback_events TO koneva_application;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON duitku_callback_events FROM koneva_application;
