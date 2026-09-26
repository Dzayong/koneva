CREATE TABLE auto_reply_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    device_key VARCHAR(32) NOT NULL REFERENCES devices(device_key) ON DELETE CASCADE,
    trigger_type VARCHAR(20) NOT NULL CHECK (trigger_type IN ('keyword', 'regex', 'all')),
    trigger_pattern TEXT NOT NULL DEFAULT '',
    response_type VARCHAR(20) NOT NULL DEFAULT 'text' CHECK (response_type IN ('text', 'template')),
    response_content TEXT NOT NULL,
    delay_ms INT NOT NULL DEFAULT 3000 CHECK (delay_ms >= 0 AND delay_ms <= 300000),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE auto_reply_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rule_id UUID REFERENCES auto_reply_rules(id) ON DELETE SET NULL,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    device_key VARCHAR(32) NOT NULL,
    inbound_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    outbound_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    recipient VARCHAR(20) NOT NULL,
    response_content TEXT NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('sent', 'blocked', 'failed')),
    error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    phone_number VARCHAR(20) NOT NULL,
    name VARCHAR(100),
    tags TEXT[] NOT NULL DEFAULT '{}',
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, phone_number)
);

CREATE TABLE message_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    content TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, name)
);

CREATE INDEX idx_auto_reply_rules_device ON auto_reply_rules(device_key) WHERE is_active;
CREATE INDEX idx_auto_reply_logs_tenant ON auto_reply_logs(tenant_id, created_at DESC);
CREATE INDEX idx_contacts_tenant ON contacts(tenant_id, created_at DESC);
CREATE INDEX idx_templates_tenant ON message_templates(tenant_id, created_at DESC);

CREATE TRIGGER update_auto_reply_rules_updated_at BEFORE UPDATE ON auto_reply_rules
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_contacts_updated_at BEFORE UPDATE ON contacts
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_message_templates_updated_at BEFORE UPDATE ON message_templates
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
