-- T1.1: final four-plan catalog, annual checkout closed for new orders, grandfathered Pelajar pricing,
-- hard monthly quota with a hold state (not a silent drop) and a server-trusted transactional exemption.

-- ---- Plan display extras: only "tim" (Bisnis CS) uses these; NULL elsewhere falls back to the raw number. ----
ALTER TABLE plans ADD COLUMN IF NOT EXISTS quota_headline VARCHAR(60);
ALTER TABLE plans ADD COLUMN IF NOT EXISTS quota_note VARCHAR(200);

-- ---- Pelajar: new-order price becomes 29.000; existing subscribers are grandfathered below. Migration 013
-- seeded every plan's price_is_final at the column default (false, "not announced yet"); the owner's decision
-- (docs/ROADMAP_2026-09-28.md "Keputusan terkunci") makes these four real, final, published prices, so this
-- migration is what actually turns price_is_final on for the two carried-over plans (the two new ones below are
-- inserted with it already true).
UPDATE plans SET price_month_idr = 29000, price_year_idr = 0, price_is_final = true, updated_at = now() WHERE id = 'pelajar';

-- ---- umkm keeps its id/limits (already 99.000 / 3 device / 10.000 pesan / 3 anggota); display name becomes "Tim UKM". ----
UPDATE plans SET name = 'Tim UKM', price_year_idr = 0, price_is_final = true, sort_order = 3, updated_at = now() WHERE id = 'umkm';

-- ---- New: Asisten Pribadi. No existing id used 'asisten'; picked as a stable, readable id alongside pelajar/umkm. ----
INSERT INTO plans (id, name, audience, price_month_idr, price_year_idr, max_devices, monthly_messages, max_members,
                    trial_days, requires_student_verification, price_is_final, published, sort_order, features)
VALUES ('asisten', 'Asisten Pribadi', 'asisten', 59000, 0, 1, 5000, 1, NULL, false, true, true, 2,
        '["1 nomor WhatsApp","5.000 pesan per bulan","Pemanasan, skor kesiapan, dan deteksi ban","Dokumentasi dan komunitas"]')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, audience = EXCLUDED.audience,
  price_month_idr = EXCLUDED.price_month_idr, price_year_idr = EXCLUDED.price_year_idr,
  max_devices = EXCLUDED.max_devices, monthly_messages = EXCLUDED.monthly_messages, max_members = EXCLUDED.max_members,
  price_is_final = EXCLUDED.price_is_final, published = EXCLUDED.published, sort_order = EXCLUDED.sort_order,
  features = EXCLUDED.features, updated_at = now();

-- ---- New: Bisnis CS. id 'tim' is unused today; the real enforced quota is 20.000 (fair-use), displayed as "Unlimited pesan*". ----
INSERT INTO plans (id, name, audience, price_month_idr, price_year_idr, max_devices, monthly_messages, max_members,
                    trial_days, requires_student_verification, price_is_final, published, sort_order, features,
                    quota_headline, quota_note)
VALUES ('tim', 'Bisnis CS', 'tim', 199000, 0, 5, 20000, 10, NULL, false, true, true, 4,
        '["5 nomor WhatsApp","Unlimited pesan* (fair-use 20.000/bulan)","10 anggota tim dengan peran","Kunci API ber-izin dan webhook bertanda tangan","Dukungan prioritas"]',
        'Unlimited pesan*', 'Fair-use 20.000 pesan/bulan (±667/hari). Pada limit: pesan ditahan dan ditawarkan naik paket, tidak dihentikan diam-diam. OTP/transaksional tidak dihitung.')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, audience = EXCLUDED.audience,
  price_month_idr = EXCLUDED.price_month_idr, price_year_idr = EXCLUDED.price_year_idr,
  max_devices = EXCLUDED.max_devices, monthly_messages = EXCLUDED.monthly_messages, max_members = EXCLUDED.max_members,
  price_is_final = EXCLUDED.price_is_final, published = EXCLUDED.published, sort_order = EXCLUDED.sort_order,
  features = EXCLUDED.features, quota_headline = EXCLUDED.quota_headline, quota_note = EXCLUDED.quota_note, updated_at = now();

-- ---- Grandfather: every existing Pelajar subscription (any status) keeps paying 19.000 while it stays on plan 'pelajar'. ----
-- A snapshot/override on the subscription row itself, so it survives renewal (activatePaid never touches this column)
-- and never rewrites past invoice amounts (invoices already store their own amount_idr at time of purchase).
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS price_override_idr INTEGER;
UPDATE subscriptions SET price_override_idr = 19000 WHERE plan_id = 'pelajar' AND price_override_idr IS NULL;

-- ---- Quota hold: a message over quota is held, not dropped or silently failed, and not counted as sent. ----
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_status_check;
ALTER TABLE messages ADD CONSTRAINT messages_status_check CHECK (
  status IN ('queued', 'quota_hold', 'sending', 'sent', 'delivered', 'read', 'failed', 'blocked', 'received')
);
-- Marks a message that was exempted from quota counting (server-verified transactional/OTP), for meter transparency and audit.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS quota_exempt BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS messages_quota_hold_idx ON messages (tenant_id, status, created_at) WHERE status = 'quota_hold';

-- ---- Transactional/OTP exemption rate limiting: a separate, server-only counter so the exemption itself cannot be
-- used to send unlimited quota-free volume. Mirrors otp_rate_events' dim/key/at shape (see otp-limits.ts) but kept
-- as its own table: this is about the customer's own outbound WhatsApp traffic, unrelated to KONEVA's email OTP budget.
CREATE TABLE IF NOT EXISTS message_exempt_events (
  id BIGSERIAL PRIMARY KEY,
  dim VARCHAR(20) NOT NULL,
  key VARCHAR(64) NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS message_exempt_events_lookup_idx ON message_exempt_events (dim, key, at);
