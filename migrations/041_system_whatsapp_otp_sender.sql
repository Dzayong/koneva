-- A platform-owned workspace is used only to host the WhatsApp sender for signup OTPs.
ALTER TABLE tenants ADD COLUMN is_system BOOLEAN NOT NULL DEFAULT false;

INSERT INTO tenants (name, email, webhook_secret, max_devices, quota_messages, used_messages, status, is_system)
VALUES ('KONEVA System Sender', 'system-otp@koneva.invalid', NULL, 1, 0, 0, 'active', true);

CREATE TABLE system_whatsapp_otp_sender (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE RESTRICT,
  device_key VARCHAR(32) UNIQUE REFERENCES devices(device_key) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES operators(id) ON DELETE SET NULL
);

INSERT INTO system_whatsapp_otp_sender (tenant_id)
SELECT id FROM tenants WHERE is_system = true AND email = 'system-otp@koneva.invalid';

GRANT SELECT, INSERT, UPDATE ON system_whatsapp_otp_sender TO koneva_application;
