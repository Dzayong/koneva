CREATE TABLE IF NOT EXISTS media_objects (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  content_type VARCHAR(64) NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size > 0),
  original_name VARCHAR(180),
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  expires_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS media_objects_expiry_idx ON media_objects (expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS media_objects_tenant_device_idx ON media_objects (tenant_id, device_id, created_at DESC);
