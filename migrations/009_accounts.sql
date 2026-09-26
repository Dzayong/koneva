-- People who sign in to the console, and which workspaces (tenants) they belong to.
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) NOT NULL,
  name VARCHAR(120) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  email_verified_at TIMESTAMP,
  terms_accepted_at TIMESTAMP,
  terms_version VARCHAR(20),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uq ON users (lower(email));

CREATE TABLE IF NOT EXISTS memberships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'admin', 'developer', 'viewer')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, tenant_id)
);
CREATE INDEX IF NOT EXISTS memberships_tenant_idx ON memberships (tenant_id);

-- Opaque session tokens; only a SHA-256 hash is stored so a database leak does not leak sessions.
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMP,
  revoked_at TIMESTAMP,
  user_agent VARCHAR(200),
  ip VARCHAR(64)
);
CREATE INDEX IF NOT EXISTS user_sessions_user_idx ON user_sessions (user_id);
