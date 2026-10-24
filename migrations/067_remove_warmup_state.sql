-- Device age no longer gates sending; remove the obsolete warm-up state and
-- per-message approval flag. Delivery health, consent, rate, and content guards remain.
ALTER TABLE devices
  DROP COLUMN IF EXISTS warmup_started_at,
  DROP COLUMN IF EXISTS warmup_completed_at;

ALTER TABLE messages
  DROP COLUMN IF EXISTS allow_warmup_override;

-- Remove the obsolete warm-up claim from plans that may still be displayed.
UPDATE plans
SET features = (
  SELECT jsonb_agg(
    CASE
      WHEN feature = '"Pemanasan, skor kesiapan, dan deteksi ban"'::jsonb
        THEN '"Nomor langsung dapat digunakan setelah tersambung"'::jsonb
      ELSE feature
    END
    ORDER BY ordinal
  )
  FROM jsonb_array_elements(features) WITH ORDINALITY AS item(feature, ordinal)
)
WHERE features @> '["Pemanasan, skor kesiapan, dan deteksi ban"]'::jsonb;
