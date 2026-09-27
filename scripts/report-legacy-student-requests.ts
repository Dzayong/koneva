// READ-ONLY report of workspaces whose student verification was requested before the operator panel (no student_requests row).
// They need to submit again (the dashboard tells them so on its billing page). This script never writes, never contacts anyone,
// and prints workspace ids and dates only: no email, note or name. Existing approvals are unaffected and not listed.
import { adminContext } from './lib/operator-admin';

async function main(): Promise<void> {
  adminContext(); // same explicit-database guard as the other offline tools (also requires an accountable label)
  const { default: pool } = await import('../src/shared/database/connection');
  try {
    const rows = (await pool.query<{ id: string; student_request_at: Date }>(
      `SELECT t.id, t.student_request_at FROM tenants t
       WHERE t.student_request_at IS NOT NULL AND t.student_verified_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM student_requests r WHERE r.tenant_id = t.id)
       ORDER BY t.student_request_at, t.id`)).rows;
    process.stdout.write(`Legacy pending student requests needing resubmission: ${rows.length}\n`);
    for (const row of rows) process.stdout.write(`${row.id}\t${row.student_request_at.toISOString()}\n`);
  } finally { await pool.end(); }
}
void main().catch(() => { process.stderr.write('Report failed. Check explicit configuration (docs/OPERATOR_PANEL.md).\n'); process.exitCode = 1; });
