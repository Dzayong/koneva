-- Paid Pelajar workspaces stay active while proof is being reviewed.
ALTER TABLE student_requests DROP CONSTRAINT IF EXISTS student_requests_status_check;
ALTER TABLE student_requests ADD CONSTRAINT student_requests_status_check
  CHECK (status IN ('pending','approved','rejected','correction_required','expired','superseded'));
ALTER TABLE student_requests ADD COLUMN IF NOT EXISTS correction_due_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS student_invalid_decisions INTEGER NOT NULL DEFAULT 0 CHECK (student_invalid_decisions >= 0);
CREATE INDEX IF NOT EXISTS student_requests_correction_due_idx
  ON student_requests(correction_due_at, tenant_id, id) WHERE status = 'correction_required';

-- Durable notification outbox: decisions commit even if the email provider is temporarily down.
CREATE TABLE IF NOT EXISTS student_email_outbox (
  id BIGSERIAL PRIMARY KEY,
  student_request_id UUID NOT NULL REFERENCES student_requests(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recipient TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('correction_deadline','second_invalid_suspend')),
  due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS student_email_outbox_request_kind_idx ON student_email_outbox(student_request_id, kind);
CREATE INDEX IF NOT EXISTS student_email_outbox_pending_idx ON student_email_outbox(created_at, id) WHERE sent_at IS NULL;
