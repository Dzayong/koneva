ALTER TABLE contacts ADD CONSTRAINT contacts_id_tenant_unique UNIQUE (id, tenant_id);

CREATE TABLE contact_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL CHECK (length(btrim(name)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name),
  UNIQUE (id, tenant_id)
);

CREATE TABLE contact_group_members (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  group_id UUID NOT NULL,
  contact_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, contact_id),
  FOREIGN KEY (group_id, tenant_id) REFERENCES contact_groups(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id, tenant_id) REFERENCES contacts(id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX contact_group_members_contact_idx ON contact_group_members(tenant_id, contact_id);

CREATE TABLE scheduled_campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  group_id UUID NOT NULL,
  device_key VARCHAR(32) NOT NULL,
  name VARCHAR(100) NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  media_url TEXT,
  media_type VARCHAR(20) NOT NULL DEFAULT 'image' CHECK (media_type IN ('image', 'video', 'document')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'processing', 'completed', 'cancelled')),
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  FOREIGN KEY (group_id, tenant_id) REFERENCES contact_groups(id, tenant_id) ON DELETE RESTRICT
);

CREATE INDEX scheduled_campaigns_due_idx ON scheduled_campaigns(scheduled_at)
  WHERE status IN ('scheduled', 'processing');
CREATE INDEX scheduled_campaigns_tenant_idx ON scheduled_campaigns(tenant_id, created_at DESC);

CREATE TABLE scheduled_campaign_recipients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID NOT NULL REFERENCES scheduled_campaigns(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL,
  phone_number VARCHAR(20) NOT NULL,
  name VARCHAR(100) NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'queued', 'quota_hold', 'failed')),
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  error_code VARCHAR(80),
  error_message VARCHAR(300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, phone_number),
  FOREIGN KEY (contact_id, tenant_id) REFERENCES contacts(id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX scheduled_campaign_recipients_pending_idx
  ON scheduled_campaign_recipients(campaign_id, created_at) WHERE status = 'pending';

CREATE UNIQUE INDEX messages_campaign_external_id_idx
  ON messages(external_id) WHERE external_id LIKE 'cmp_%';

-- The 30-day closed-account retention job anonymizes a tenant rather than deleting its row.
-- Remove the added campaign/group records when that existing job marks the account purged.
CREATE OR REPLACE FUNCTION purge_contact_campaign_data_on_account_close() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.retention_purged_at IS NULL AND NEW.retention_purged_at IS NOT NULL THEN
    DELETE FROM public.scheduled_campaigns WHERE tenant_id = NEW.id;
    DELETE FROM public.contact_groups WHERE tenant_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION purge_contact_campaign_data_on_account_close() FROM PUBLIC;

CREATE TRIGGER tenants_purge_contact_campaign_data
AFTER UPDATE OF retention_purged_at ON tenants
FOR EACH ROW EXECUTE FUNCTION purge_contact_campaign_data_on_account_close();
