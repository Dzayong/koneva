-- Invitations to join a workspace (link shared by the owner, bound to one email, expires).
CREATE TABLE IF NOT EXISTS invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'developer', 'viewer')),
  token_hash CHAR(64) NOT NULL UNIQUE,
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMP,
  accepted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  revoked_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS invitations_tenant_idx ON invitations (tenant_id);

-- Who did what, for accountability inside a workspace.
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_type VARCHAR(20) NOT NULL,
  actor_id VARCHAR(64),
  actor_label VARCHAR(255),
  action VARCHAR(60) NOT NULL,
  target_type VARCHAR(30),
  target_id VARCHAR(80),
  ip VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_log_tenant_time_idx ON audit_log (tenant_id, created_at DESC);
