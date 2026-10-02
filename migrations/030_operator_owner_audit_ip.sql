-- Keep the source address only for successful Owner Insights audit reads.
-- The audit table's immutable trigger also covers this new field.
ALTER TABLE operator_audit
  ADD COLUMN IF NOT EXISTS client_ip INET;

COMMENT ON COLUMN operator_audit.client_ip IS
  'Client IP for owner.insights.view only; raw address is retained with the immutable audit row.';
