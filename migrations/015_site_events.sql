-- First-party, cookie-free visit counters for the public site: no visitor id, no IP, only counts per day.
CREATE TABLE IF NOT EXISTS site_events (
  day DATE NOT NULL,
  event VARCHAR(24) NOT NULL,
  referrer VARCHAR(80) NOT NULL DEFAULT '',
  utm VARCHAR(40) NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, event, referrer, utm)
);
