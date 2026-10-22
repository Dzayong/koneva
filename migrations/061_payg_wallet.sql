-- Prepaid wallet and per-send charge reservations. The feature stays disabled until
-- an operator configures a rate and explicitly enables PAYG.
CREATE TABLE payg_settings (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  price_per_message_idr BIGINT CHECK (price_per_message_idr IS NULL OR price_per_message_idr > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES operators(id) ON DELETE SET NULL,
  CHECK (NOT enabled OR price_per_message_idr IS NOT NULL)
);
INSERT INTO payg_settings(singleton, enabled, price_per_message_idr) VALUES(TRUE, FALSE, NULL)
ON CONFLICT(singleton) DO NOTHING;

CREATE TABLE wallet_accounts (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  available_idr BIGINT NOT NULL DEFAULT 0 CHECK (available_idr >= 0),
  reserved_idr BIGINT NOT NULL DEFAULT 0 CHECK (reserved_idr >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE wallet_ledger (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type VARCHAR(16) NOT NULL CHECK (event_type IN ('topup', 'reserve', 'charge', 'release', 'adjustment')),
  amount_idr BIGINT NOT NULL CHECK (amount_idr > 0),
  available_delta_idr BIGINT NOT NULL,
  reserved_delta_idr BIGINT NOT NULL,
  idempotency_key VARCHAR(180) NOT NULL,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  attempt_no INTEGER,
  invoice_number VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (
    (event_type = 'topup' AND available_delta_idr = amount_idr AND reserved_delta_idr = 0)
    OR (event_type = 'reserve' AND available_delta_idr = -amount_idr AND reserved_delta_idr = amount_idr)
    OR (event_type = 'charge' AND available_delta_idr = 0 AND reserved_delta_idr = -amount_idr)
    OR (event_type = 'release' AND available_delta_idr = amount_idr AND reserved_delta_idr = -amount_idr)
    OR (event_type = 'adjustment' AND available_delta_idr + reserved_delta_idr <> 0)
  )
);
CREATE INDEX wallet_ledger_tenant_idx ON wallet_ledger(tenant_id, created_at DESC, id DESC);

CREATE TABLE wallet_topups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_number VARCHAR(64) NOT NULL UNIQUE,
  amount_idr BIGINT NOT NULL CHECK (amount_idr BETWEEN 10000 AND 10000000),
  status VARCHAR(12) NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','paid','void')),
  paid_at TIMESTAMPTZ,
  payment_reference VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX wallet_topups_tenant_idx ON wallet_topups(tenant_id, created_at DESC);

CREATE TABLE message_wallet_reservations (
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  attempt_no INTEGER NOT NULL CHECK (attempt_no >= 0),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  amount_idr BIGINT NOT NULL CHECK (amount_idr > 0),
  state VARCHAR(12) NOT NULL CHECK (state IN ('reserved', 'captured', 'released', 'uncertain')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  PRIMARY KEY(message_id, attempt_no)
);
CREATE INDEX message_wallet_reservations_tenant_idx ON message_wallet_reservations(tenant_id, state, created_at DESC);

-- A send is billed once after WhatsApp accepts it. Definite failures return the
-- reserved amount. delivery_uncertain stays reserved for manual review, never auto-refunded.
CREATE FUNCTION settle_message_wallet_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r message_wallet_reservations%ROWTYPE;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  SELECT * INTO r FROM message_wallet_reservations
    WHERE message_id = NEW.id AND attempt_no = COALESCE(NEW.retry_count, 0)
    FOR UPDATE;
  -- A late SERVER_ACK can resolve a formerly ambiguous send; it remains reserved
  -- until then and is captured only when WhatsApp confirms acceptance.
  IF NOT FOUND OR r.state NOT IN ('reserved','uncertain') THEN RETURN NEW; END IF;

  IF NEW.status IN ('sent','delivered','read') THEN
    UPDATE message_wallet_reservations SET state='captured', resolved_at=now()
      WHERE message_id=NEW.id AND attempt_no=r.attempt_no;
    UPDATE wallet_accounts SET reserved_idr=reserved_idr-r.amount_idr, updated_at=now() WHERE tenant_id=r.tenant_id;
    INSERT INTO wallet_ledger(tenant_id,event_type,amount_idr,available_delta_idr,reserved_delta_idr,idempotency_key,message_id,attempt_no)
      VALUES(r.tenant_id,'charge',r.amount_idr,0,-r.amount_idr,'message:'||NEW.id||':'||r.attempt_no||':charge',NEW.id,r.attempt_no)
      ON CONFLICT(tenant_id,idempotency_key) DO NOTHING;
  ELSIF NEW.status IN ('failed','blocked') AND NEW.error_message='delivery_uncertain' THEN
    UPDATE message_wallet_reservations SET state='uncertain'
      WHERE message_id=NEW.id AND attempt_no=r.attempt_no;
  ELSIF NEW.status IN ('failed','blocked') THEN
    UPDATE message_wallet_reservations SET state='released', resolved_at=now()
      WHERE message_id=NEW.id AND attempt_no=r.attempt_no;
    UPDATE wallet_accounts SET available_idr=available_idr+r.amount_idr,
      reserved_idr=reserved_idr-r.amount_idr, updated_at=now() WHERE tenant_id=r.tenant_id;
    INSERT INTO wallet_ledger(tenant_id,event_type,amount_idr,available_delta_idr,reserved_delta_idr,idempotency_key,message_id,attempt_no)
      VALUES(r.tenant_id,'release',r.amount_idr,r.amount_idr,-r.amount_idr,'message:'||NEW.id||':'||r.attempt_no||':release',NEW.id,r.attempt_no)
      ON CONFLICT(tenant_id,idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER messages_settle_wallet AFTER UPDATE OF status ON messages
  FOR EACH ROW EXECUTE FUNCTION settle_message_wallet_reservation();

-- Wallet history is append-only for the application role. No row is removed to
-- "fix" a balance; corrections must be explicit adjustment entries.
GRANT SELECT, INSERT, UPDATE ON payg_settings, wallet_accounts, message_wallet_reservations TO koneva_application;
GRANT SELECT, INSERT ON wallet_ledger, wallet_topups TO koneva_application;
GRANT UPDATE(status, paid_at, payment_reference) ON wallet_topups TO koneva_application;
GRANT USAGE, SELECT ON SEQUENCE wallet_ledger_id_seq TO koneva_application;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON wallet_ledger FROM koneva_application;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON wallet_topups FROM koneva_application;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON payg_settings, wallet_accounts, message_wallet_reservations FROM koneva_application;
