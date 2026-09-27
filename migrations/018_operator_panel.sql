-- Operator identities are deliberately independent of tenant users and ADMIN_API_KEY.
CREATE TABLE operators (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL UNIQUE CHECK (email = lower(btrim(email))),
  name VARCHAR(120) NOT NULL,
  password_hash TEXT NOT NULL,
  permissions TEXT[] NOT NULL DEFAULT '{}',
  disabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (permissions <@ ARRAY['payments:read','payments:confirm','students:read','students:decide','workspaces:read','audit:read']::text[])
);
CREATE TABLE operator_sessions (
  token_hash TEXT PRIMARY KEY,
  operator_id UUID NOT NULL REFERENCES operators(id),
  authenticated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  idle_expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '30 minutes',
  absolute_expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '8 hours',
  touched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX operator_sessions_operator_idx ON operator_sessions(operator_id);
CREATE TABLE operator_login_attempts (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE FUNCTION revoke_operator_sessions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.password_hash IS DISTINCT FROM OLD.password_hash OR NEW.disabled_at IS DISTINCT FROM OLD.disabled_at THEN
    UPDATE operator_sessions SET revoked_at = now() WHERE operator_id = NEW.id AND revoked_at IS NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER operator_credentials_changed AFTER UPDATE ON operators
FOR EACH ROW EXECUTE FUNCTION revoke_operator_sessions();

ALTER TABLE invoices ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE invoices ADD COLUMN confirmed_by UUID REFERENCES operators(id);
-- Deliberately fails if legacy paid references collide; never silently rewrites financial history.
CREATE UNIQUE INDEX invoices_paid_reference_unique ON invoices(lower(btrim(method)), lower(btrim(reference)))
WHERE status = 'paid' AND reference IS NOT NULL AND btrim(reference) <> '';
CREATE INDEX invoices_operator_page_idx ON invoices(created_at DESC, id DESC);
CREATE INDEX invoices_operator_status_idx ON invoices(status, created_at DESC, id DESC);
CREATE FUNCTION bump_invoice_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.version := OLD.version + 1; RETURN NEW; END $$;
CREATE TRIGGER invoice_version_changed BEFORE UPDATE ON invoices
FOR EACH ROW EXECUTE FUNCTION bump_invoice_version();

CREATE TABLE student_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requester_email TEXT NOT NULL,
  note VARCHAR(500),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','superseded')),
  version INTEGER NOT NULL DEFAULT 1,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  decided_by UUID REFERENCES operators(id),
  reason VARCHAR(500)
);
CREATE UNIQUE INDEX student_requests_pending_idx ON student_requests(tenant_id) WHERE status = 'pending';
CREATE INDEX student_requests_tenant_idx ON student_requests(tenant_id, requested_at DESC, id DESC);
CREATE INDEX student_requests_page_idx ON student_requests(requested_at DESC, id DESC);
CREATE INDEX student_requests_status_idx ON student_requests(status, requested_at DESC, id DESC);
-- Old storage did not record the requester. Do not invent their identity from the workspace email.
-- Existing verified flags remain valid; historical pending requests require a fresh submission.

CREATE TABLE operator_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  operator_id UUID NOT NULL REFERENCES operators(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  target_label TEXT,
  reason TEXT,
  changes JSONB NOT NULL,
  request_id UUID NOT NULL
);
CREATE INDEX operator_audit_page_idx ON operator_audit(at DESC, id DESC);
CREATE INDEX operator_audit_target_idx ON operator_audit(target_type, target_id, at DESC, id DESC);
CREATE INDEX operator_audit_operator_idx ON operator_audit(operator_id, at DESC, id DESC);
CREATE FUNCTION immutable_operator_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'operator audit is append only'; END $$;
CREATE TRIGGER operator_audit_immutable BEFORE UPDATE OR DELETE ON operator_audit
FOR EACH ROW EXECUTE FUNCTION immutable_operator_audit();

CREATE TABLE operator_idempotency (
  operator_id UUID NOT NULL REFERENCES operators(id),
  operation TEXT NOT NULL,
  target_id UUID NOT NULL,
  key UUID NOT NULL,
  payload_hash TEXT NOT NULL,
  response_body JSON NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (operator_id, operation, target_id, key)
);
-- No automatic deletion: retained at least 72 hours (currently indefinitely).
