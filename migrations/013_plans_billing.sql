-- Plans, subscriptions and manual invoices. Limits still live on tenants (max_devices, quota_messages)
-- so existing enforcement keeps working; they are now derived from the plan when it is applied.
CREATE TABLE IF NOT EXISTS plans (
  id VARCHAR(20) PRIMARY KEY,
  name VARCHAR(60) NOT NULL,
  audience VARCHAR(30) NOT NULL,
  price_month_idr INTEGER NOT NULL DEFAULT 0,
  price_year_idr INTEGER NOT NULL DEFAULT 0,
  max_devices INTEGER NOT NULL,
  monthly_messages INTEGER NOT NULL,
  max_members INTEGER NOT NULL DEFAULT 1,
  trial_days INTEGER,
  requires_student_verification BOOLEAN NOT NULL DEFAULT false,
  -- Prices are shown to customers only once the operator marks them final.
  price_is_final BOOLEAN NOT NULL DEFAULT false,
  published BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  features JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO plans (id, name, audience, price_month_idr, price_year_idr, max_devices, monthly_messages, max_members,
                   trial_days, requires_student_verification, published, sort_order, features) VALUES
  ('trial', 'Uji coba', 'trial', 0, 0, 1, 200, 1, 14, false, false, 0,
   '["1 nomor WhatsApp","200 pesan","14 hari"]'),
  ('pelajar', 'Pelajar', 'pelajar', 19000, 190000, 1, 1000, 1, NULL, true, true, 1,
   '["1 nomor WhatsApp","1.000 pesan per bulan","Pemanasan, skor kesiapan, dan deteksi ban","Dokumentasi dan komunitas"]'),
  ('umkm', 'UMKM', 'umkm', 99000, 990000, 3, 10000, 3, NULL, false, true, 2,
   '["3 nomor WhatsApp","10.000 pesan per bulan","3 anggota tim dengan peran","Kunci API ber-izin dan webhook bertanda tangan","Dukungan standar"]'),
  ('internal', 'Internal', 'internal', 0, 0, 100, 1000000, 100, NULL, false, false, 99, '[]')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS subscriptions (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id VARCHAR(20) NOT NULL REFERENCES plans(id),
  status VARCHAR(20) NOT NULL CHECK (status IN ('trial', 'active', 'past_due', 'suspended', 'expired', 'cancelled')),
  cycle VARCHAR(10) CHECK (cycle IN ('monthly', 'yearly')),
  period_start TIMESTAMP NOT NULL DEFAULT NOW(),
  period_end TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Workspaces that existed before plans keep working without an end date.
INSERT INTO subscriptions (tenant_id, plan_id, status, period_start, period_end)
SELECT id, 'internal', 'active', created_at, NULL FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS usage_period_start TIMESTAMP;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS student_verified_at TIMESTAMP;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS student_request_at TIMESTAMP;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS student_note TEXT;

CREATE SEQUENCE IF NOT EXISTS invoice_number_seq;

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  number VARCHAR(30) NOT NULL UNIQUE,
  plan_id VARCHAR(20) NOT NULL REFERENCES plans(id),
  cycle VARCHAR(10) NOT NULL CHECK (cycle IN ('monthly', 'yearly')),
  amount_idr INTEGER NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid', 'void')),
  due_at TIMESTAMP NOT NULL,
  paid_at TIMESTAMP,
  method VARCHAR(30),
  reference VARCHAR(80),
  note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS invoices_tenant_idx ON invoices (tenant_id, created_at DESC);
