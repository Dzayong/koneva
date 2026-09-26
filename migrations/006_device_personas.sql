-- Per-number behaviour profile: each WhatsApp number gets its own stable
-- "habits" (waking hours, pacing, how long a burst lasts before it rests).
CREATE TABLE IF NOT EXISTS device_personas (
  device_id UUID PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  seed VARCHAR(64) NOT NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Jakarta',
  wake_hour REAL NOT NULL,
  sleep_hour REAL NOT NULL,
  delay_min_ms INTEGER NOT NULL,
  delay_max_ms INTEGER NOT NULL,
  burst_size INTEGER NOT NULL,
  rest_min_ms INTEGER NOT NULL,
  rest_max_ms INTEGER NOT NULL,
  typing_ms_per_char INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT device_personas_hours_chk CHECK (wake_hour >= 0 AND wake_hour < sleep_hour AND sleep_hour <= 24),
  CONSTRAINT device_personas_delay_chk CHECK (delay_min_ms >= 1000 AND delay_max_ms >= delay_min_ms),
  CONSTRAINT device_personas_rest_chk CHECK (rest_min_ms >= 60000 AND rest_max_ms >= rest_min_ms),
  CONSTRAINT device_personas_burst_chk CHECK (burst_size BETWEEN 2 AND 60)
);
