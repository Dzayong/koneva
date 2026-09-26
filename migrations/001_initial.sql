CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE,
    api_key VARCHAR(64) UNIQUE NOT NULL,
    webhook_url TEXT,
    webhook_secret VARCHAR(64),
    max_devices INT DEFAULT 3,
    quota_messages INT DEFAULT 10000,
    used_messages INT DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    device_key VARCHAR(32) UNIQUE NOT NULL,
    phone_number VARCHAR(20),
    label VARCHAR(100),
    container_id VARCHAR(64),
    container_port INT,
    status VARCHAR(20) DEFAULT 'offline' CHECK (status IN ('offline', 'starting', 'pending_qr', 'online', 'paused', 'banned', 'error')),
    qr_code TEXT,
    health_score INT DEFAULT 50 CHECK (health_score >= 0 AND health_score <= 100),
    last_connected TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id),
    device_id UUID REFERENCES devices(id),
    device_key VARCHAR(32),
    direction VARCHAR(10) NOT NULL DEFAULT 'outbound' CHECK (direction IN ('inbound', 'outbound')),
    from_number VARCHAR(20),
    to_number VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    type VARCHAR(20) DEFAULT 'text' CHECK (type IN ('text', 'image', 'document', 'video', 'audio')),
    status VARCHAR(20) DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'blocked', 'received')),
    external_id VARCHAR(64),
    whatsapp_message_id VARCHAR(64),
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    sent_at TIMESTAMP,
    delivered_at TIMESTAMP,
    read_at TIMESTAMP
);

CREATE TABLE webhook_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id),
    event_type VARCHAR(50) NOT NULL,
    payload JSONB,
    response_status INT,
    response_body TEXT,
    retry_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_devices_tenant ON devices(tenant_id);
CREATE INDEX idx_devices_status ON devices(status);
CREATE INDEX idx_devices_device_key ON devices(device_key);
CREATE INDEX idx_messages_tenant ON messages(tenant_id, created_at DESC);
CREATE INDEX idx_messages_status ON messages(status) WHERE status = 'queued';
CREATE INDEX idx_messages_device ON messages(device_key, created_at DESC);
CREATE INDEX idx_messages_external_id ON messages(external_id);
CREATE INDEX idx_webhook_logs_tenant ON webhook_logs(tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_devices_updated_at BEFORE UPDATE ON devices FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
