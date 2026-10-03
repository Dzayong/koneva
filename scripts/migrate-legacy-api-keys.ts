// Owner-run cutover off the legacy static tenant API key (decision 2026-10-02: full removal, no grace
// period). Two explicit phases so the owner can hand the new key to each tenant and confirm they have
// switched before the old one stops working; neither phase prints, logs, or writes the key value to
// stdout/stderr — the new key is written only to a private output file the caller must prepare.
//
// Usage:
//   OPERATOR_PROVISION_LOCAL=true OPERATOR_ADMIN_LABEL=<you> \
//     npx ts-node scripts/migrate-legacy-api-keys.ts provision                    (dry-run, lists only)
//   ...                                                        provision --out <0600 file> --execute
//   ...                                                        cutover                                 (dry-run)
//   ...                                                        cutover --execute
//
// provision: for every tenant with a non-null api_key and no active scoped key, creates one scoped key
//   (full KEY_SCOPES, same ceiling as an Owner-created key) and appends {tenant_id, key} as one JSON
//   line to --out. Tenants that already have an active scoped key are skipped (idempotent re-run).
// cutover: for every tenant with a non-null api_key AND at least one active scoped key, sets api_key to
//   NULL. Refuses (lists the tenant ids, never a key) any tenant that still has no scoped key — run
//   provision first. This is the step that actually stops the old key working for that tenant.
// Once `cutover` reports zero "not ready" tenants, run scripts/drop-legacy-api-key-column.ts once to
// remove the column entirely (that script is intentionally separate, not part of migrations/).
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { adminContext } from './lib/operator-admin';

interface TenantRow { id: string; name: string }

function checkOutFile(outPath: string): void {
  const resolved = path.resolve(outPath);
  const stat = fs.lstatSync(resolved, { throwIfNoEntry: false });
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('--out must be an existing regular file, not a symlink: create it first (e.g. `install -m 600 /dev/null <file>`)');
  }
  if ((fs.statSync(resolved).mode & 0o077) !== 0) {
    throw new Error('--out file permissions must be 0600 or stricter');
  }
}

async function provision(pool: Pool, outPath: string | undefined, execute: boolean): Promise<void> {
  if (execute) checkOutFile(outPath!); // only needed once something is actually about to be written
  const candidates = (await pool.query<TenantRow>(
    `SELECT t.id, t.name FROM tenants t
     WHERE t.api_key IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM api_keys k WHERE k.tenant_id = t.id AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > now()))
     ORDER BY t.name`,
  )).rows;
  process.stdout.write(`${candidates.length} tenant(s) need a scoped key (never printing the legacy or new key value).\n`);
  for (const tenant of candidates) process.stdout.write(`  - ${tenant.id}  ${tenant.name}\n`);
  if (!execute) { process.stdout.write('Dry-run only. Pass --execute to create scoped keys.\n'); return; }
  const { createApiKey, KEY_SCOPES } = await import('../src/api-gateway/services/apikey.service');
  for (const tenant of candidates) {
    const created = await createApiKey(tenant.id, null, 'owner', {
      name: 'Migrasi dari API key lama (cutover 2026-10)', scopes: [...KEY_SCOPES],
    });
    fs.appendFileSync(path.resolve(outPath!), `${JSON.stringify({ tenant_id: tenant.id, key: created.key })}\n`, { mode: 0o600 });
  }
  process.stdout.write(`Created ${candidates.length} scoped key(s); values written only to ${outPath}.\n`);
}

async function cutover(pool: Pool, execute: boolean): Promise<void> {
  const ready = (await pool.query<TenantRow>(
    `SELECT t.id, t.name FROM tenants t
     WHERE t.api_key IS NOT NULL
       AND EXISTS (SELECT 1 FROM api_keys k WHERE k.tenant_id = t.id AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > now()))
     ORDER BY t.name`,
  )).rows;
  const notReady = (await pool.query<TenantRow>(
    `SELECT t.id, t.name FROM tenants t
     WHERE t.api_key IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM api_keys k WHERE k.tenant_id = t.id AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > now()))
     ORDER BY t.name`,
  )).rows;
  process.stdout.write(`${ready.length} tenant(s) ready to cut over (have a scoped key already).\n`);
  for (const tenant of ready) process.stdout.write(`  - ${tenant.id}  ${tenant.name}\n`);
  if (notReady.length > 0) {
    process.stdout.write(`${notReady.length} tenant(s) NOT ready (no scoped key yet) — run provision for these first:\n`);
    for (const tenant of notReady) process.stdout.write(`  - ${tenant.id}  ${tenant.name}\n`);
  }
  if (!execute) { process.stdout.write('Dry-run only. Pass --execute to clear the legacy key for the ready tenants.\n'); return; }
  for (const tenant of ready) {
    await pool.query('UPDATE tenants SET api_key = NULL WHERE id = $1', [tenant.id]);
  }
  process.stdout.write(`Cleared the legacy key for ${ready.length} tenant(s). Their static key no longer authenticates.\n`);
}

async function main(): Promise<void> {
  const [, , action, ...rest] = process.argv;
  const execute = rest.includes('--execute');
  const outIndex = rest.indexOf('--out');
  const outPath = outIndex >= 0 ? rest[outIndex + 1] : undefined;
  const context = adminContext();
  const pool = new Pool({ connectionString: context.databaseUrl, max: 1 });
  try {
    if (action === 'provision') {
      if (execute && !outPath) throw new Error('provision --execute requires --out <0600 file>');
      await provision(pool, outPath, execute);
    } else if (action === 'cutover') {
      await cutover(pool, execute);
    } else {
      throw new Error('Usage: migrate-legacy-api-keys.ts <provision --out <file>|cutover> [--execute]');
    }
  } finally { await pool.end(); }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Legacy API key migration failed.'}\n`);
  process.exitCode = 1;
});
