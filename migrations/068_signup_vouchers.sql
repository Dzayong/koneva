-- Signup vouchers grant prepaid wallet credit once WhatsApp OTP activates the account.
CREATE TABLE signup_vouchers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code_hash CHAR(64) NOT NULL UNIQUE,
  code_suffix CHAR(4) NOT NULL,
  credit_idr BIGINT NOT NULL CHECK (credit_idr BETWEEN 1 AND 100000000),
  max_redemptions INTEGER NOT NULL CHECK (max_redemptions BETWEEN 1 AND 100000),
  redemptions_count INTEGER NOT NULL DEFAULT 0 CHECK (redemptions_count BETWEEN 0 AND max_redemptions),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  created_by UUID REFERENCES operators(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disabled_at TIMESTAMPTZ,
  CHECK (active OR disabled_at IS NOT NULL)
);
CREATE INDEX signup_vouchers_created_idx ON signup_vouchers(created_at DESC, id DESC);

ALTER TABLE users ADD COLUMN pending_signup_voucher_id UUID REFERENCES signup_vouchers(id) ON DELETE SET NULL;

CREATE TABLE signup_voucher_redemptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  voucher_id UUID NOT NULL REFERENCES signup_vouchers(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  credit_idr BIGINT NOT NULL CHECK (credit_idr BETWEEN 1 AND 100000000),
  wallet_ledger_id BIGINT NOT NULL UNIQUE REFERENCES wallet_ledger(id) ON DELETE RESTRICT,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX signup_voucher_redemptions_voucher_idx ON signup_voucher_redemptions(voucher_id, redeemed_at DESC);

ALTER TABLE wallet_ledger DROP CONSTRAINT wallet_ledger_event_type_check;
ALTER TABLE wallet_ledger ADD CONSTRAINT wallet_ledger_event_type_check
  CHECK (event_type IN ('topup', 'reserve', 'charge', 'release', 'adjustment', 'voucher'));
ALTER TABLE wallet_ledger DROP CONSTRAINT wallet_ledger_check;
ALTER TABLE wallet_ledger ADD CONSTRAINT wallet_ledger_check CHECK (
  (event_type = 'topup' AND available_delta_idr = amount_idr AND reserved_delta_idr = 0)
  OR (event_type = 'voucher' AND available_delta_idr = amount_idr AND reserved_delta_idr = 0)
  OR (event_type = 'reserve' AND available_delta_idr = -amount_idr AND reserved_delta_idr = amount_idr)
  OR (event_type = 'charge' AND available_delta_idr = 0 AND reserved_delta_idr = -amount_idr)
  OR (event_type = 'release' AND available_delta_idr = amount_idr AND reserved_delta_idr = -amount_idr)
  OR (event_type = 'adjustment' AND available_delta_idr + reserved_delta_idr <> 0)
);

GRANT SELECT, INSERT, UPDATE ON signup_vouchers TO koneva_application;
GRANT SELECT, INSERT ON signup_voucher_redemptions TO koneva_application;
GRANT USAGE, SELECT ON SEQUENCE wallet_ledger_id_seq TO koneva_application;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON signup_voucher_redemptions FROM koneva_application;
