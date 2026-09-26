-- Scoped, revocable API keys. Only a hash is stored; the key itself is shown once at creation.
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL,
  prefix VARCHAR(16) NOT NULL,
  key_hash CHAR(64) NOT NULL UNIQUE,
  scopes TEXT[] NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMP,
  expires_at TIMESTAMP,
  revoked_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS api_keys_tenant_idx ON api_keys (tenant_id);
