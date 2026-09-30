CREATE TABLE IF NOT EXISTS recipient_preferences (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone_number VARCHAR(20) NOT NULL CHECK (phone_number ~ '^[0-9]{7,20}$'),
  status VARCHAR(12) NOT NULL CHECK (status IN ('opted_in', 'opted_out')),
  source VARCHAR(20) NOT NULL CHECK (source IN ('manual', 'inbound_keyword', 'legacy_history')),
  source_note VARCHAR(500),
  evidence_ref VARCHAR(100),
  decided_by UUID,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, phone_number),
  CHECK (source <> 'manual' OR (source_note IS NOT NULL AND length(btrim(source_note)) > 0))
);

CREATE INDEX IF NOT EXISTS recipient_preferences_status_idx
  ON recipient_preferences (tenant_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS recipient_consent_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone_number VARCHAR(20) NOT NULL CHECK (phone_number ~ '^[0-9]{7,20}$'),
  status VARCHAR(12) NOT NULL CHECK (status IN ('opted_in', 'opted_out')),
  source VARCHAR(20) NOT NULL CHECK (source IN ('manual', 'inbound_keyword', 'legacy_history')),
  source_note VARCHAR(500),
  evidence_ref VARCHAR(100),
  actor_kind VARCHAR(12) NOT NULL CHECK (actor_kind IN ('user', 'system')),
  actor_id VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (source <> 'manual' OR (source_note IS NOT NULL AND length(btrim(source_note)) > 0))
);

CREATE INDEX IF NOT EXISTS recipient_consent_events_lookup_idx
  ON recipient_consent_events (tenant_id, phone_number, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS recipient_consent_events_evidence_idx
  ON recipient_consent_events (tenant_id, source, evidence_ref) WHERE evidence_ref IS NOT NULL;

-- Preserve the existing worker's 365-day opt-out behavior when moving from message-history lookup to durable
-- workspace-level state. Keep the evidence reference only; never duplicate inbound message content.
WITH legacy_opt_outs AS (
  SELECT DISTINCT ON (m.tenant_id, normalized.phone_number)
    m.tenant_id,
    normalized.phone_number,
    m.id::text AS evidence_ref,
    m.created_at AS decided_at
  FROM messages AS m
  CROSS JOIN LATERAL (SELECT regexp_replace(COALESCE(m.from_number, ''), '[^0-9]', '', 'g') AS phone_number) AS normalized
  WHERE m.direction = 'inbound'
    AND m.tenant_id IS NOT NULL
    AND length(normalized.phone_number) BETWEEN 7 AND 20
    AND m.created_at >= now() - interval '365 days'
    AND length(m.content) <= 200
    AND m.content ~* '\m(stop|berhenti|unsubscribe|unsub|jangan (kirim|chat|hubungi|spam)|hapus (nomor|kontak)|batal(kan)? langganan|spam)\M'
  ORDER BY m.tenant_id, normalized.phone_number, m.created_at DESC
)
INSERT INTO recipient_preferences (tenant_id, phone_number, status, source, evidence_ref, decided_at)
SELECT tenant_id, phone_number, 'opted_out', 'legacy_history', evidence_ref, decided_at
FROM legacy_opt_outs
ON CONFLICT (tenant_id, phone_number) DO NOTHING;

INSERT INTO recipient_consent_events
  (tenant_id, phone_number, status, source, evidence_ref, actor_kind, created_at)
SELECT tenant_id, phone_number, status, source, evidence_ref, 'system', decided_at
FROM recipient_preferences
WHERE source = 'legacy_history'
ON CONFLICT DO NOTHING;
