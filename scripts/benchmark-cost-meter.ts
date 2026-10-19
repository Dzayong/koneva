import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { estimateDatabaseUsage } from '../src/device-manager/database-usage';

async function main(): Promise<void> {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString || !process.env['COST_METER_BENCHMARK']) {
    throw new Error('Refusing to run: use scripts/test-cost-meter.sh with the disposable benchmark database.');
  }
  const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 2_000 });
  try {
    const identity = await pool.query<{ database: string }>('SELECT current_database() AS database');
    if (identity.rows[0]?.database !== 'koneva_cost_meter_test') {
      throw new Error('Refusing to seed a database other than koneva_cost_meter_test.');
    }
    await pool.query(`
      CREATE TABLE tenants (id uuid PRIMARY KEY);
      CREATE TABLE messages (id bigserial PRIMARY KEY, tenant_id uuid, content text NOT NULL);
      CREATE INDEX messages_tenant_idx ON messages(tenant_id);
      CREATE TABLE webhook_logs (id bigserial PRIMARY KEY, tenant_id uuid, payload jsonb);
      CREATE TABLE contacts (id bigserial PRIMARY KEY, tenant_id uuid);
      CREATE TABLE device_commands (id bigserial PRIMARY KEY, tenant_id uuid);
      CREATE TABLE device_events (id bigserial PRIMARY KEY, tenant_id uuid);
      CREATE TABLE auto_reply_logs (id bigserial PRIMARY KEY, tenant_id uuid);
      CREATE TABLE auto_reply_rules (id bigserial PRIMARY KEY, tenant_id uuid);
      INSERT INTO tenants(id) VALUES
        ('00000000-0000-4000-8000-000000000001'),
        ('00000000-0000-4000-8000-000000000002');
      INSERT INTO messages(tenant_id, content)
      SELECT CASE WHEN n % 10 < 8 THEN '00000000-0000-4000-8000-000000000001'::uuid
                  ELSE '00000000-0000-4000-8000-000000000002'::uuid END,
             repeat('synthetic-x', 16)
      FROM generate_series(1, 20000) AS n;
      ANALYZE messages;
    `);

    const startedAt = performance.now();
    const estimate = await estimateDatabaseUsage(pool);
    const elapsedMs = Math.round(performance.now() - startedAt);
    const messages = estimate.sampledTables.find((table) => table.table === 'messages');
    const tenantA = estimate.tenants.find((tenant) => tenant.tenantId === '00000000-0000-4000-8000-000000000001');
    const tenantB = estimate.tenants.find((tenant) => tenant.tenantId === '00000000-0000-4000-8000-000000000002');
    assert.ok(messages && messages.relationBytes > 4 * 1024 * 1024, 'synthetic messages table should exceed per-table sample budget');
    assert.ok(messages.samplePercent < 100 && messages.sampledRows > 0 && messages.sampledRows < 20_000, 'estimator should sample a subset of message rows');
    assert.ok(tenantA && tenantB);
    const messageBytes = tenantA.breakdown.find((table) => table.table === 'messages')!.estimatedBytes
      + tenantB.breakdown.find((table) => table.table === 'messages')!.estimatedBytes;
    const tenantAShare = tenantA.breakdown.find((table) => table.table === 'messages')!.estimatedBytes / messageBytes;
    assert.ok(Math.abs(tenantAShare - 0.8) <= 0.2, `sampled share ${tenantAShare} should be near synthetic 80% distribution`);
    assert.equal(estimate.billingReady, false);
    console.log(JSON.stringify({
      result: 'PASS', environment: 'disposable synthetic PostgreSQL',
      elapsedMs, messagesRelationBytes: messages.relationBytes,
      samplePercent: messages.samplePercent, sampledRows: messages.sampledRows,
      expectedTenantAShare: 0.8, estimatedTenantAShare: Number(tenantAShare.toFixed(4)),
      billingReady: estimate.billingReady,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Synthetic cost-meter benchmark failed');
  process.exitCode = 1;
});
