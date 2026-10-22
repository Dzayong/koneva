CREATE TABLE IF NOT EXISTS whatsapp_channels (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  device_key VARCHAR(32) NOT NULL,
  jid VARCHAR(128) NOT NULL,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(512),
  invite_code VARCHAR(256),
  is_owner BOOLEAN NOT NULL DEFAULT FALSE,
  followed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, device_id, jid)
);

CREATE INDEX IF NOT EXISTS whatsapp_channels_device_idx
  ON whatsapp_channels (tenant_id, device_id, followed_at DESC);
