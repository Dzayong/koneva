import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  const files = (await readdir(path.join(root, 'migrations')))
    .filter((name) => /^\d{3}_.*\.sql$/.test(name) && name < '025_recipient_consent.sql')
    .sort();
  for (const name of files) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(await readFile(path.join(root, 'migrations', name), 'utf8'));
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  const { rows: [firstTenant] } = await pool.query(
    "INSERT INTO tenants (name, email, api_key, webhook_secret) VALUES ('Consent migration test', 'consent-a@example.test', 'consent-test-a', 'consent-hook-a') RETURNING id",
  );
  const { rows: [secondTenant] } = await pool.query(
    "INSERT INTO tenants (name, email, api_key, webhook_secret) VALUES ('Consent isolation test', 'consent-b@example.test', 'consent-test-b', 'consent-hook-b') RETURNING id",
  );
  const inWindow = await pool.query(
    `INSERT INTO messages (tenant_id, direction, from_number, to_number, content, created_at)
     VALUES ($1, 'inbound', '+628111111111', '628199999999', 'STOP!', now() - interval '2 days') RETURNING id`,
    [firstTenant.id],
  );
  await pool.query(
    `INSERT INTO messages (tenant_id, direction, from_number, to_number, content, created_at) VALUES
       ($1, 'inbound', '628222222222', '628199999999', 'Halo, ada produk baru?', now() - interval '1 day'),
       ($1, 'inbound', '628333333333', '628199999999', 'berhenti', now() - interval '366 days'),
       ($1, 'inbound', '628444444444', '628199999999', repeat('x', 201) || ' STOP', now() - interval '1 day')`,
    [firstTenant.id],
  );

  const migration = await readFile(path.join(root, 'migrations', '025_recipient_consent.sql'), 'utf8');
  await pool.query(migration);
  const initial = await pool.query(
    'SELECT tenant_id, phone_number, status, source, evidence_ref, source_note FROM recipient_preferences ORDER BY phone_number',
  );
  assert.deepEqual(initial.rows, [{
    tenant_id: firstTenant.id,
    phone_number: '628111111111',
    status: 'opted_out',
    source: 'legacy_history',
    evidence_ref: inWindow.rows[0].id,
    source_note: null,
  }]);
  assert.equal(initial.rows.some((row) => row.tenant_id === secondTenant.id), false, 'legacy backfill is workspace-scoped');
  assert.equal(initial.rows.some((row) => 'content' in row), false, 'message text is not copied into consent data');

  await pool.query(migration); // idempotent SQL rerun must not duplicate the audit evidence.
  const events = await pool.query('SELECT id FROM recipient_consent_events WHERE tenant_id = $1 AND phone_number = $2', [firstTenant.id, '628111111111']);
  assert.equal(events.rows.length, 1);
  console.log(`recipient consent migration: ${files.length + 1} migrations, legacy backfill and idempotence passed`);
} finally {
  await pool.end();
}
