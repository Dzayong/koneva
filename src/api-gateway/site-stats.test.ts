import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import pool from '../shared/database/connection';
import { getSiteStats, recordSiteEvent } from './services/site-stats.service';

type Query = (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
const database = pool as unknown as { query: Query };
const originalQuery = database.query;
afterEach(() => { database.query = originalQuery; });

test('recordSiteEvent stores only sanitised, bounded referrer and utm text', async () => {
  let values: unknown[] = [];
  database.query = async (_t, v) => { values = v ?? []; return { rows: [] }; };
  await recordSiteEvent('view', 'Www.Google.com/<script>', 'Ads Campaign #1 '.repeat(10));
  assert.equal(values[0], 'view');
  assert.equal(values[1], 'www.google.comscript');
  assert.match(String(values[2]), /^[a-z0-9._-]{1,40}$/);
});

test('getSiteStats reports signup rate as signups per landing view', async () => {
  database.query = async (text) => {
    if (text.includes('GROUP BY event')) return { rows: [{ event: 'view', count: 200 }, { event: 'signup', count: 10 }] };
    return { rows: [] };
  };
  const stats = await getSiteStats(30);
  assert.equal(stats.signup_rate, 0.05);
  assert.equal(stats.days, 30);
});

test('getSiteStats has no rate before any visit and clamps the window', async () => {
  database.query = async () => ({ rows: [] });
  const stats = await getSiteStats(99999);
  assert.equal(stats.signup_rate, null);
  assert.equal(stats.days, 365);
});
