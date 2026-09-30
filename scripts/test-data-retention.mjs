import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const connectionString = process.env.RETENTION_TEST_DATABASE_URL;
assert.ok(connectionString, 'RETENTION_TEST_DATABASE_URL is required');
const testUrl = new URL(connectionString);
assert.ok(['127.0.0.1', 'localhost'].includes(testUrl.hostname) && testUrl.pathname === '/operator_test', 'Refusing a non-disposable database');
const pool = new Pool({ connectionString });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  const client = await pool.connect();
  try {
    await client.query('CREATE TABLE _migrations (name text PRIMARY KEY)');
    for (const file of (await fs.readdir(path.join(root, 'migrations'))).filter((name) => name.endsWith('.sql')).sort()) {
      await client.query('BEGIN');
      try {
        await client.query(await fs.readFile(path.join(root, 'migrations', file), 'utf8'));
        await client.query('INSERT INTO _migrations(name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration failed: ${file}`, { cause: error });
      }
    }
    await client.query('BEGIN');
    try {
      await client.query(await fs.readFile(path.join(root, 'migrations', '026_data_retention.sql'), 'utf8'));
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error('Migration 026 idempotence check failed', { cause: error });
    }

    // Simulate ordinary app and isolated retention logins. The app has direct DELETE
    // rights intentionally: row triggers must still reject its forged marker.
    await client.query('CREATE ROLE retention_app_test NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE');
    await client.query('CREATE ROLE retention_runner_test NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE');
    await client.query('GRANT koneva_retention_executor TO retention_runner_test');
    await client.query("CREATE ROLE retention_runner_login LOGIN PASSWORD 'retention_test_login' NOSUPERUSER NOCREATEDB NOCREATEROLE");
    await client.query('GRANT retention_runner_test TO retention_runner_login');
    await client.query('GRANT SELECT (id), UPDATE (retention_purged_at) ON tenants TO retention_app_test');
    await client.query('GRANT SELECT, DELETE ON invoices, operator_audit, operator_security_events, audit_log TO retention_app_test');

    const tenantId = (await client.query(`INSERT INTO tenants(name,email,api_key,status)
      VALUES ('synthetic-retention-tenant','synthetic@example.test','retention-api-key','active') RETURNING id`)).rows[0].id;
    const deviceId = (await client.query(`INSERT INTO devices(tenant_id,device_key)
      VALUES ($1,'retention-test-device') RETURNING id`, [tenantId])).rows[0].id;
    const operatorId = (await client.query(`INSERT INTO operators(email,name,password_hash)
      VALUES ('retention-operator@example.test','Synthetic Operator','test-hash') RETURNING id`)).rows[0].id;
    const invoiceId = (await client.query(`INSERT INTO invoices(tenant_id,number,plan_id,cycle,amount_idr,due_at,created_at)
      VALUES ($1,'RETENTION-OLD-INVOICE','pelajar','monthly',29000,now()-interval '11 years',timezone('UTC',now())-interval '11 years') RETURNING id`, [tenantId])).rows[0].id;
    const recentInvoiceId = (await client.query(`INSERT INTO invoices(tenant_id,number,plan_id,cycle,amount_idr,due_at)
      VALUES ($1,'RETENTION-RECENT-INVOICE','pelajar','monthly',29000,now()+interval '1 day') RETURNING id`, [tenantId])).rows[0].id;
    const purgeTenantId = (await client.query(`INSERT INTO tenants(name,email,api_key,status)
      VALUES ('synthetic-closed-retention-tenant','closed@example.test','closed-retention-api-key','deleted') RETURNING id`)).rows[0].id;
    const createdClosed = (await client.query('SELECT closed_at,retention_purged_at FROM tenants WHERE id=$1', [purgeTenantId])).rows[0];
    assert.ok(createdClosed.closed_at, 'direct creation in deleted state starts closure clock now');
    assert.equal(createdClosed.retention_purged_at, null, 'insert cannot seed the system purge marker');
    await client.query('ALTER TABLE tenants DISABLE TRIGGER tenants_closed_at_stamp');
    await client.query("UPDATE tenants SET closed_at=now()-interval '31 days' WHERE id=$1", [purgeTenantId]);
    await client.query('ALTER TABLE tenants ENABLE TRIGGER tenants_closed_at_stamp');
    const snapshotInvoiceId = (await client.query(`INSERT INTO invoices(tenant_id,number,plan_id,cycle,amount_idr,due_at,billing_name_snapshot,billing_email_snapshot)
      VALUES ($1,'RETENTION-SNAPSHOT-INVOICE','pelajar','monthly',29000,now()-interval '1 day','Billing snapshot name','billing-snapshot@example.test') RETURNING id`, [purgeTenantId])).rows[0].id;
    await client.query(`INSERT INTO audit_log(tenant_id,actor_type,actor_id,actor_label,ip,action)
      VALUES ($1,'user','00000000-0000-4000-8000-000000000005','Synthetic person','192.0.2.15','account.retention-test')`, [purgeTenantId]);

    // closed_at is server stamped, protected against rewrites, cleared on reopen, and restarted on re-close.
    const closed = await client.query("UPDATE tenants SET status='deleted' WHERE id=$1 RETURNING closed_at", [tenantId]);
    assert.ok(closed.rows[0].closed_at, 'delete transition must stamp closed_at');
    await assert.rejects(client.query("UPDATE tenants SET closed_at=now()-interval '31 days' WHERE id=$1", [tenantId]), /closed_at cannot be changed/);
    await client.query('SET ROLE retention_app_test');
    await assert.rejects(client.query('UPDATE tenants SET retention_purged_at=now() WHERE id=$1', [tenantId]), /retention_purged_at is system-managed/);
    await client.query('RESET ROLE');
    await client.query("UPDATE tenants SET status='active' WHERE id=$1", [tenantId]);
    assert.equal((await client.query('SELECT closed_at FROM tenants WHERE id=$1', [tenantId])).rows[0].closed_at, null);
    await client.query("UPDATE tenants SET status='deleted' WHERE id=$1", [tenantId]);
    // Seed old synthetic rows by moving the timestamp under the disposable superuser only.
    await client.query('ALTER TABLE tenants DISABLE TRIGGER tenants_closed_at_stamp');
    await client.query("UPDATE tenants SET closed_at=now()-interval '31 days' WHERE id=$1", [tenantId]);
    await client.query('ALTER TABLE tenants ENABLE TRIGGER tenants_closed_at_stamp');

    const oldMessage = (await client.query(`INSERT INTO messages(tenant_id,device_id,device_key,to_number,content,status,created_at)
      VALUES ($1,$2,'retention-test-device','15551234567','synthetic-retention-message','sent',timezone('UTC',now())-interval '91 days') RETURNING id`, [tenantId, deviceId])).rows[0].id;
    await client.query(`INSERT INTO messages(tenant_id,device_id,device_key,to_number,content,status,created_at)
      VALUES ($1,$2,'retention-test-device','15557654321','synthetic-active-message','queued',timezone('UTC',now())-interval '91 days')`, [tenantId, deviceId]);
    await client.query(`INSERT INTO messages(tenant_id,device_id,device_key,to_number,content,status,created_at)
      VALUES ($1,$2,'retention-test-device','15550000000','synthetic-recent-message','sent',timezone('UTC',now())-interval '89 days')`, [tenantId, deviceId]);
    await client.query(`INSERT INTO message_status_history(message_id,status,created_at) VALUES ($1,'sent',timezone('UTC',now())-interval '91 days')`, [oldMessage]);
    await client.query(`INSERT INTO auto_reply_logs(tenant_id,device_key,recipient,response_content,status,created_at)
      VALUES ($1,'retention-test-device','15551234567','synthetic response','sent',timezone('UTC',now())-interval '91 days')`, [tenantId]);
    await client.query(`INSERT INTO status_views(device_id,status_message_id,viewer,viewed_at)
      VALUES ($1,'old-status','15551234567',now()-interval '91 days')`, [deviceId]);
    await client.query(`INSERT INTO webhook_logs(tenant_id,event_type,created_at)
      VALUES ($1,'synthetic.retention',timezone('UTC',now())-interval '31 days')`, [tenantId]);
    await client.query(`INSERT INTO operator_audit(operator_id,action,target_type,target_id,changes,request_id,at)
      VALUES ($1,'synthetic','test','00000000-0000-4000-8000-000000000001','{}','00000000-0000-4000-8000-000000000002',now()-interval '13 months')`, [operatorId]);
    await client.query(`INSERT INTO operator_audit(operator_id,action,target_type,target_id,changes,request_id)
      VALUES ($1,'synthetic-fresh','test','00000000-0000-4000-8000-000000000003','{}','00000000-0000-4000-8000-000000000004')`, [operatorId]);
    await client.query(`INSERT INTO operator_security_events(at,event) VALUES (now()-interval '13 months','mfa_failed')`);
    await client.query(`INSERT INTO operator_security_events(event) VALUES ('mfa_failed')`);
    await client.query(`INSERT INTO audit_log(tenant_id,actor_type,action,created_at)
      VALUES ($1,'system','synthetic',timezone('UTC',now())-interval '13 months')`, [tenantId]);
    await client.query(`INSERT INTO audit_log(tenant_id,actor_type,action)
      VALUES ($1,'system','synthetic-fresh')`, [tenantId]);
    await client.query("SET TIME ZONE 'America/Los_Angeles'");

    await client.query('SET ROLE retention_runner_test');
    const messagePreview = (await client.query("SELECT retention_dry_run('messages_90d') AS report")).rows[0].report;
    const assertNumericCounts = (report, expected) => {
      const numeric = Object.fromEntries(Object.entries(report.counts).filter(([, value]) => typeof value === 'number'));
      assert.deepEqual(numeric, expected);
      for (const [key, value] of Object.entries(report.counts)) {
        if (key.startsWith('oldest_') && value !== null) assert.match(value, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+Z$/);
      }
    };
    assertNumericCounts(messagePreview, { messages: 2, auto_reply_logs: 1, status_views: 1, unresolved_active_messages: 1 });
    assert.equal(messagePreview.protected_invoice_candidates, 1, 'non-invoice jobs report but never include old invoice candidates');
    assert.match(messagePreview.cutoff_utc, /Z$/);
    assert.doesNotMatch(JSON.stringify(messagePreview), /15551234567|synthetic-retention-message|example\.test/);
    const webhookPreview = (await client.query("SELECT retention_dry_run('webhook_logs_30d') AS report")).rows[0].report;
    assertNumericCounts(webhookPreview, { webhook_logs: 1 });
    const accountPreview = (await client.query("SELECT retention_dry_run('closed_accounts_30d') AS report")).rows[0].report;
    assertNumericCounts(accountPreview, { closed_accounts: 2, accounts_with_active_messages: 1, accounts_with_active_commands: 0 });
    const securityPreview = (await client.query("SELECT retention_dry_run('security_logs_12mo') AS report")).rows[0].report;
    assertNumericCounts(securityPreview, { operator_audit: 1, operator_security_events: 1, audit_log: 1 });
    const invoicePreview = (await client.query("SELECT retention_dry_run('invoices_10y') AS report")).rows[0].report;
    assertNumericCounts(invoicePreview, { invoices: 1 });
    assert.equal(invoicePreview.protected_invoice_candidates, 1);
    await assert.rejects(client.query("SELECT retention_dry_run('all')"), /unknown retention dry-run job/);
    assert.equal((await client.query('SELECT count(*) FROM messages WHERE id=$1', [oldMessage])).rows[0].count, '1', 'dry-run must not delete data');
    await client.query("SET TIME ZONE 'Asia/Jakarta'");
    const jakartaMessagePreview = (await client.query("SELECT retention_dry_run('messages_90d') AS report")).rows[0].report;
    assert.match(jakartaMessagePreview.generated_at_utc, /Z$/);
    assert.match(jakartaMessagePreview.cutoff_utc, /Z$/);
    assertNumericCounts(jakartaMessagePreview, { messages: 2, auto_reply_logs: 1, status_views: 1, unresolved_active_messages: 1 });
    assert.deepEqual(jakartaMessagePreview.counts, messagePreview.counts, 'UTC eligibility and oldest timestamps are stable under Asia/Jakarta session timezone');
    const secondPreview = (await client.query("SELECT retention_dry_run('messages_90d') AS report")).rows[0].report;
    assertNumericCounts(secondPreview, { messages: 2, auto_reply_logs: 1, status_views: 1, unresolved_active_messages: 1 });
    assert.equal((await client.query('SELECT count(*) FROM messages WHERE id=$1', [oldMessage])).rows[0].count, '1', 'repeated dry-runs return counts without mutating rows');
    await client.query('RESET ROLE');

    // Forging the custom marker is insufficient: the invoker role is not the NOLOGIN definer.
    await client.query('SET ROLE retention_app_test');
    await client.query("SELECT set_config('koneva.retention_job','invoices_10y',false)");
    await assert.rejects(client.query("SELECT retention_dry_run('messages_90d')"), /permission denied/);
    await assert.rejects(client.query('DELETE FROM invoices WHERE id=$1', [invoiceId]), /invoice deletion is disabled/);
    await assert.rejects(client.query("SELECT retention_delete_security_logs_12mo(now()-interval '13 months',50)"), /permission denied/);
    await client.query('RESET ROLE');

    // Only a login deliberately granted the NOLOGIN executor role can call the constrained routine.
    await client.query('SET ROLE retention_runner_test');
    await assert.rejects(client.query('SELECT retention_delete_messages_90d(now(),50)'), /cutoff outside policy window/);
    await assert.rejects(client.query('SELECT retention_delete_webhook_logs_30d(now(),50)'), /cutoff outside policy window/);
    await assert.rejects(client.query('SELECT retention_delete_security_logs_12mo(now(),50)'), /cutoff outside policy window/);
    await assert.rejects(client.query('SELECT retention_delete_closed_accounts_30d(now(),50)'), /cutoff outside policy window/);
    assert.equal((await client.query('SELECT count(*) FROM messages WHERE id=$1', [oldMessage])).rows[0].count, '1', 'runner cannot supply a future cutoff to any job');
    const removedLogs = (await client.query("SELECT retention_delete_security_logs_12mo(now()-interval '12 months',50) AS deleted")).rows[0].deleted;
    assert.deepEqual(removedLogs, { operator_audit: 1, operator_security_events: 1, audit_log: 1, retention_job_runs: 0, status: 'succeeded' });
    assert.equal((await client.query('SELECT count(*) FROM invoices WHERE id=$1', [invoiceId])).rows[0].count, '1', 'security retention must never touch invoices');
    assert.equal((await client.query('SELECT count(*) FROM operator_security_events')).rows[0].count, '1', 'fresh security events survive');
    assert.equal((await client.query('SELECT count(*) FROM operator_audit')).rows[0].count, '1', 'fresh operator audits survive');
    await client.query('RESET ROLE');
    assert.equal((await client.query('SELECT count(*) FROM invoices WHERE id=$1', [invoiceId])).rows[0].count, '1');
    assert.equal((await client.query('SELECT count(*) FROM invoices WHERE id=$1', [recentInvoiceId])).rows[0].count, '1');
    assert.equal((await client.query('SELECT count(*) FROM operator_security_events')).rows[0].count, '1');

    const runnerUrl = new URL(connectionString);
    runnerUrl.username = 'retention_runner_login';
    runnerUrl.password = 'retention_test_login';
    const dryRun = spawnSync(process.execPath, ['--require', 'ts-node/register', 'scripts/data-retention.ts'], {
      cwd: root,
      env: { ...process.env, RETENTION_DATABASE_URL: runnerUrl.toString() },
      encoding: 'utf8',
    });
    assert.equal(dryRun.status, 0, `dedicated dry-run runner failed: ${dryRun.stderr}`);
    const scheduleClock = spawnSync(process.execPath, ['--require', 'ts-node/register', '-e', `const {nextDailyUtcRun}=require('./scripts/data-retention');const cases=[['2026-10-01T02:59:59.000Z',1000],['2026-10-01T03:00:00.000Z',86400000],['2026-10-01T03:00:01.000Z',86399000]];for(const [now,expected] of cases){if(nextDailyUtcRun(new Date(now))!==expected)throw Error('bad UTC scheduler delay for '+now)}`], {
      cwd: root, env: { ...process.env, TZ: 'Asia/Jakarta' }, encoding: 'utf8',
    });
    assert.equal(scheduleClock.status, 0, `UTC scheduler clock calculation failed: ${scheduleClock.stderr}`);
    const savedReports = (await client.query(`SELECT job,mode,status,cutoff_at,candidate_counts,oldest_eligible,completed_at,duration_ms,error_code
      FROM retention_job_runs ORDER BY id`)).rows;
    assert.equal(savedReports.length, 5, 'scheduler one-shot should persist one report per DB retention category');
    assert.deepEqual(savedReports.map((row) => row.job).sort(), ['closed_accounts_30d','invoices_10y','messages_90d','security_logs_12mo','webhook_logs_30d']);
    for (const report of savedReports) {
      assert.equal(report.mode, 'dry_run');
      assert.notEqual(report.status, 'running');
      assert.ok(report.completed_at);
      assert.ok(Number.isInteger(report.duration_ms) && report.duration_ms >= 0);
      assert.equal(report.error_code, null);
      for (const [key, value] of Object.entries(report.candidate_counts)) {
        assert.match(key, /^[a-z][a-z0-9_]*$/);
        assert.equal(typeof value, 'number', 'persisted counts must be numeric aggregate fields only');
      }
      assert.doesNotMatch(JSON.stringify(report), /15551234567|synthetic-retention-message|example\.test/);
    }
    const beforeDisabledExecute = (await client.query('SELECT count(*) FROM messages WHERE id=$1', [oldMessage])).rows[0].count;
    const deniedExecute = spawnSync(process.execPath, ['--require', 'ts-node/register', 'scripts/data-retention.ts', '--job', 'messages_90d', '--execute'], {
      cwd: root,
      env: { ...process.env, RETENTION_DATABASE_URL: runnerUrl.toString(), RETENTION_DELETE_ENABLED: 'true' },
      encoding: 'utf8',
    });
    assert.equal(deniedExecute.status, 1, 'execute requires both independent owner gates');
    assert.match(deniedExecute.stderr, /requires both RETENTION_DELETE_ENABLED/);
    assert.equal((await client.query('SELECT count(*) FROM messages WHERE id=$1', [oldMessage])).rows[0].count, beforeDisabledExecute, 'a blocked runner must not delete');

    const runDelete = (job) => {
      const result = spawnSync(process.execPath, ['--require', 'ts-node/register', 'scripts/data-retention.ts', '--job', job, '--execute'], {
        cwd: root,
        env: { ...process.env, RETENTION_DATABASE_URL: runnerUrl.toString(), RETENTION_DELETE_ENABLED: 'true', RETENTION_LIVE_DELETE_APPROVED: 'true' },
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, `disposable ${job} delete job failed: ${result.stderr}`);
      return JSON.parse(result.stdout.trim());
    };
    const messageDelete = runDelete('messages_90d');
    assert.equal(messageDelete.status, 'partial', 'old queued messages are protected and keep the message job partial');
    assert.equal((await client.query('SELECT count(*) FROM messages WHERE id=$1', [oldMessage])).rows[0].count, '0', 'eligible old message should be removed');
    assert.equal((await client.query("SELECT count(*) FROM messages WHERE content='synthetic-active-message'")).rows[0].count, '1', 'active queued message must be preserved');
    assert.equal((await client.query('SELECT count(*) FROM messages WHERE content=\'synthetic-recent-message\'')).rows[0].count, '1', 'fresh message must be preserved');
    assert.equal((await client.query("SELECT count(*) FROM status_views WHERE viewed_at < now()-interval '90 days'")).rows[0].count, '0');
    const webhookDelete = runDelete('webhook_logs_30d');
    assert.equal(webhookDelete.status, 'succeeded');
    assert.equal((await client.query("SELECT count(*) FROM webhook_logs WHERE created_at < now()-interval '30 days'")).rows[0].count, '0');
    const closedDelete = runDelete('closed_accounts_30d');
    assert.equal(closedDelete.status, 'partial', 'a blocked account keeps the account job partial while other eligible accounts can be purged');
    const purged = (await client.query('SELECT status,name,email,retention_purged_at FROM tenants WHERE id=$1', [purgeTenantId])).rows[0];
    assert.equal(purged.status, 'deleted');
    assert.equal(purged.email, null);
    assert.match(purged.name, /^Closed workspace /);
    assert.ok(purged.retention_purged_at);
    const retainedInvoice = (await client.query('SELECT billing_name_snapshot,billing_email_snapshot FROM invoices WHERE id=$1', [snapshotInvoiceId])).rows[0];
    assert.deepEqual(retainedInvoice, { billing_name_snapshot: 'Billing snapshot name', billing_email_snapshot: 'billing-snapshot@example.test' }, 'invoice snapshots survive closed-account purge');
    const scrubbedAudit = (await client.query("SELECT actor_id,actor_label,target_id,ip FROM audit_log WHERE tenant_id=$1 AND action='account.retention-test'", [purgeTenantId])).rows[0];
    assert.deepEqual(scrubbedAudit, { actor_id: null, actor_label: '[account closed]', target_id: null, ip: null });
    assert.equal((await client.query('SELECT count(*) FROM invoices WHERE id=$1', [snapshotInvoiceId])).rows[0].count, '1', 'closed account purge must not delete invoice');
    const invoiceExecuteBefore = (await client.query('SELECT count(*) FROM invoices')).rows[0].count;
    const invoiceExecute = spawnSync(process.execPath, ['--require', 'ts-node/register', 'scripts/data-retention.ts', '--job', 'invoices_10y', '--execute'], {
      cwd: root,
      env: { ...process.env, RETENTION_DATABASE_URL: runnerUrl.toString(), RETENTION_DELETE_ENABLED: 'true', RETENTION_LIVE_DELETE_APPROVED: 'true' },
      encoding: 'utf8',
    });
    assert.equal(invoiceExecute.status, 1);
    assert.match(invoiceExecute.stderr, /invoice_retention_is_report_only/);
    assert.equal((await client.query('SELECT count(*) FROM invoices')).rows[0].count, invoiceExecuteBefore, 'even explicit dual-gated invoice execution is refused');
    const executeReports = (await client.query("SELECT status,error_code,affected_counts FROM retention_job_runs WHERE mode='execute' ORDER BY id")).rows;
    assert.equal(executeReports.length, 4, 'delete runs and disabled requests are durably recorded');
    assert.deepEqual(executeReports[0], { status: 'failed', error_code: 'DELETE_DISABLED', affected_counts: {} });
    assert.ok(executeReports.slice(1).every((report) => ['succeeded','partial'].includes(report.status) && report.error_code === null));
    console.log(JSON.stringify({
      result: 'T1.5 retention checks passed',
      scope: 'synthetic disposable PostgreSQL only',
      checks: ['app cannot forge job marker or call the definer procedure', 'runner cannot override policy cutoffs', 'closed_at stamps/protects/resets/restarts and purge marker is system-managed', 'UTC cutoffs hold under America/Los_Angeles and Asia/Jakarta session timezones', 'scheduler always calculates 03:00 UTC independent of local timezone', 'dry-run is aggregate-only/idempotent/non-deleting', 'dedicated runner persists five sanitized database reports', 'delete request fails closed without both independent gates', 'message/webhook/account deletion jobs pass against disposable fixtures with fresh/active data protected', 'invoice snapshots survive account purge and invoices remain undeletable in T1.5'],
      dry_run_reports: [messagePreview, webhookPreview, accountPreview, securityPreview, invoicePreview],
    }, null, 2));
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
