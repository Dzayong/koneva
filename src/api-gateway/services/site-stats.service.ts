import pool from '../../shared/database/connection';

export const SITE_EVENTS = ['view', 'cta_signup', 'cta_login', 'view_docs', 'signup'] as const;
export type SiteEvent = (typeof SITE_EVENTS)[number];

const clean = (value: string): string => value.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 80);

/** Adds one to today's (Asia/Jakarta) counter for this event, referrer host and utm source. */
export async function recordSiteEvent(event: SiteEvent, referrer = '', utm = ''): Promise<void> {
  await pool.query(
    `INSERT INTO site_events (day, event, referrer, utm, count)
     VALUES ((now() AT TIME ZONE 'Asia/Jakarta')::date, $1, $2, $3, 1)
     ON CONFLICT (day, event, referrer, utm) DO UPDATE SET count = site_events.count + 1`,
    [event, clean(referrer), clean(utm).slice(0, 40)],
  );
}

export async function getSiteStats(days = 30) {
  const window = Math.min(Math.max(Math.trunc(days) || 30, 1), 365);
  const daily = (await pool.query(
    `SELECT day::text AS day, event, SUM(count)::int AS count FROM site_events
     WHERE day >= (now() AT TIME ZONE 'Asia/Jakarta')::date - $1::int
     GROUP BY day, event ORDER BY day DESC, event`, [window],
  )).rows;
  const sources = (await pool.query(
    `SELECT COALESCE(NULLIF(utm, ''), NULLIF(referrer, ''), '(langsung)') AS source, event, SUM(count)::int AS count FROM site_events
     WHERE day >= (now() AT TIME ZONE 'Asia/Jakarta')::date - $1::int
     GROUP BY 1, event ORDER BY count DESC LIMIT 100`, [window],
  )).rows;
  const totals = (await pool.query(
    `SELECT event, SUM(count)::int AS count FROM site_events
     WHERE day >= (now() AT TIME ZONE 'Asia/Jakarta')::date - $1::int GROUP BY event`, [window],
  )).rows as Array<{ event: SiteEvent; count: number }>;
  const total = (event: SiteEvent) => totals.find((t) => t.event === event)?.count ?? 0;
  const views = total('view');
  return {
    days: window, totals: Object.fromEntries(totals.map((t) => [t.event, t.count])),
    // Share of landing visits that ended in a completed sign-up. Both counters are best-effort.
    signup_rate: views > 0 ? Number((total('signup') / views).toFixed(4)) : null,
    daily, sources,
  };
}
