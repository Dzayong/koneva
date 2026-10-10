#!/usr/bin/env node
// Helper invoked only by scripts/retention-sandbox.sh. Never reads .env.personal or any
// repo-wide DATABASE_URL — every connection string here is passed explicitly on argv by
// the caller, sourced only from the disposable sandbox container's own docker-assigned port.
import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [, , cmd, connStr, ...rest] = process.argv;

async function withClient(fn) {
  const pool = new pg.Pool({ connectionString: connStr });
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
    await pool.end();
  }
}

async function migrate() {
  await withClient(async (client) => {
    await client.query('CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY)');
    const applied = new Set((await client.query('SELECT name FROM _migrations')).rows.map((r) => r.name));
    const files = (await fs.readdir(path.join(root, 'migrations'))).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      await client.query(await fs.readFile(path.join(root, 'migrations', file), 'utf8'));
      await client.query('INSERT INTO _migrations(name) VALUES ($1)', [file]);
    }
    console.log(JSON.stringify({ migrated: files.length }));
  });
}

async function createRunner(password) {
  if (!/^[A-Za-z0-9]{16,64}$/.test(password)) throw new Error('refusing a password that is not a plain generated token');
  await withClient(async (client) => {
    await client.query(
      `DO $do$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='retention_sandbox_runner') THEN
           CREATE ROLE retention_sandbox_runner LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
         ELSE
           ALTER ROLE retention_sandbox_runner PASSWORD '${password}' INHERIT;
         END IF;
       END $do$;`,
    );
    await client.query('GRANT koneva_retention_executor TO retention_sandbox_runner');
    console.log(JSON.stringify({ runner_ready: true }));
  });
}

const SEEDERS = {
  webhook_logs_30d: async (client) => {
    const tenantId = (
      await client.query(
        `INSERT INTO tenants(name,email,api_key,status)
         VALUES ('synthetic-retention-sandbox-tenant','retention-sandbox@example.test',NULL,'active') RETURNING id`,
      )
    ).rows[0].id;
    await client.query(
      `INSERT INTO webhook_logs(tenant_id,event_type,created_at)
       VALUES ($1,'synthetic.retention-sandbox-expired',timezone('UTC',now())-interval '31 days')`,
      [tenantId],
    );
    await client.query(
      `INSERT INTO webhook_logs(tenant_id,event_type,created_at)
       VALUES ($1,'synthetic.retention-sandbox-active',timezone('UTC',now())-interval '5 days')`,
      [tenantId],
    );
    return { tenantId, seeded: { webhook_logs: 2 } };
  },
  security_logs_12mo: async (client) => {
    const tenantId = (
      await client.query(
        `INSERT INTO tenants(name,email,api_key,status)
         VALUES ('synthetic-retention-sandbox-tenant-sec','retention-sandbox-sec@example.test',NULL,'active') RETURNING id`,
      )
    ).rows[0].id;
    const operatorId = (
      await client.query(
        `INSERT INTO operators(email,name,password_hash,permissions)
         VALUES ('retention-sandbox-operator@example.test','Synthetic Retention Operator','not-a-login-hash',ARRAY[]::text[])
         RETURNING id`,
      )
    ).rows[0].id;
    await client.query(
      `INSERT INTO operator_audit(operator_id,action,target_type,target_id,changes,request_id,at)
       VALUES ($1,'synthetic-sandbox','test','00000000-0000-4000-8000-000000000011','{}','00000000-0000-4000-8000-000000000012',now()-interval '13 months')`,
      [operatorId],
    );
    await client.query(
      `INSERT INTO operator_audit(operator_id,action,target_type,target_id,changes,request_id)
       VALUES ($1,'synthetic-sandbox-fresh','test','00000000-0000-4000-8000-000000000013','{}','00000000-0000-4000-8000-000000000014')`,
      [operatorId],
    );
    await client.query(`INSERT INTO operator_security_events(at,event) VALUES (now()-interval '13 months','mfa_failed')`);
    await client.query(`INSERT INTO operator_security_events(event) VALUES ('mfa_failed')`);
    await client.query(
      `INSERT INTO audit_log(tenant_id,actor_type,action,created_at) VALUES ($1,'system','synthetic-sandbox',timezone('UTC',now())-interval '13 months')`,
      [tenantId],
    );
    await client.query(`INSERT INTO audit_log(tenant_id,actor_type,action) VALUES ($1,'system','synthetic-sandbox-fresh')`, [tenantId]);
    return { tenantId, seeded: { operator_audit: 2, operator_security_events: 2, audit_log: 2 } };
  },
  closed_accounts_30d: async (client) => {
    const tenantId = (
      await client.query(
        `INSERT INTO tenants(name,email,api_key,status)
         VALUES ('synthetic-retention-sandbox-closed','retention-sandbox-closed@example.test',NULL,'deleted') RETURNING id`,
      )
    ).rows[0].id;
    await client.query('ALTER TABLE tenants DISABLE TRIGGER tenants_closed_at_stamp');
    await client.query("UPDATE tenants SET closed_at=now()-interval '31 days' WHERE id=$1", [tenantId]);
    await client.query('ALTER TABLE tenants ENABLE TRIGGER tenants_closed_at_stamp');
    const activeTenantId = (
      await client.query(
        `INSERT INTO tenants(name,email,api_key,status)
         VALUES ('synthetic-retention-sandbox-closed-recent','retention-sandbox-closed-recent@example.test',NULL,'deleted') RETURNING id`,
      )
    ).rows[0].id;
    return { tenantId, activeTenantId, seeded: { closed_tenants_eligible: 1, closed_tenants_recent: 1 } };
  },
  invoices_10y: async (client) => {
    const tenantId = (
      await client.query(
        `INSERT INTO tenants(name,email,api_key,status)
         VALUES ('synthetic-retention-sandbox-invoice','retention-sandbox-invoice@example.test',NULL,'active') RETURNING id`,
      )
    ).rows[0].id;
    const invoiceId = (
      await client.query(
        `INSERT INTO invoices(tenant_id,number,plan_id,cycle,amount_idr,due_at,billing_name_snapshot,billing_email_snapshot,created_at)
         VALUES ($1,'RETENTION-SANDBOX-INVOICE','pelajar','monthly',29000,now()-interval '1 day','Sandbox snapshot','sandbox-snapshot@example.test',timezone('UTC',now())-interval '11 years')
         RETURNING id`,
        [tenantId],
      )
    ).rows[0].id;
    return { tenantId, invoiceId, seeded: { invoices: 1 } };
  },
};

async function seed(job) {
  const seeder = SEEDERS[job];
  if (!seeder) throw new Error(`no seeder for job ${job}`);
  await withClient(async (client) => {
    const result = await seeder(client);
    console.log(JSON.stringify(result));
  });
}

try {
  if (cmd === 'migrate') await migrate();
  else if (cmd === 'create-runner') await createRunner(rest[0]);
  else if (cmd === 'seed') await seed(rest[0]);
  else throw new Error(`unknown command: ${cmd}`);
} catch (err) {
  console.error(JSON.stringify({ error: String(err && err.message || err) }));
  process.exit(1);
}
