// Owner-run final step of the legacy static tenant API key removal (decision 2026-10-02). Deliberately
// NOT a numbered file in migrations/ — scripts/migrate.ts applies every migration automatically on
// deploy, and this column must only be dropped after a human has confirmed every tenant is cut over
// (scripts/migrate-legacy-api-keys.ts cutover --execute, with zero "NOT ready" tenants left). Running
// this script is the deliberate action; the SQL itself still refuses if any tenant slipped through.
//
// Usage: OPERATOR_PROVISION_LOCAL=true OPERATOR_ADMIN_LABEL=<you> npx ts-node scripts/drop-legacy-api-key-column.ts
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { adminContext } from './lib/operator-admin';

async function main(): Promise<void> {
  const context = adminContext();
  const sql = fs.readFileSync(path.join(__dirname, 'drop-legacy-api-key-column.sql'), 'utf8');
  const pool = new Pool({ connectionString: context.databaseUrl, max: 1 });
  try {
    await pool.query(sql);
    process.stdout.write('tenants.api_key dropped. The legacy static key no longer exists in any form.\n');
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Dropping tenants.api_key failed.'}\n`);
  process.exitCode = 1;
});
