import { Pool } from 'pg';

async function main(): Promise<void> {
  const password = process.env['APP_DB_PASSWORD'] ?? '';
  if (!/^[a-f0-9]{64}$/.test(password)) throw new Error('APP_DB_PASSWORD must be a private 32-byte hex secret.');
  if (!process.env['DATABASE_URL']) throw new Error('Admin DATABASE_URL is required for the one-time role setup.');
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'], max: 1, connectionTimeoutMillis: 5000 });
  try {
    const literal = (await pool.query<{ value: string }>('SELECT quote_literal($1) AS value', [password])).rows[0]?.value;
    if (!literal) throw new Error('Could not prepare the runtime role credential.');
    await pool.query(`ALTER ROLE koneva_app WITH LOGIN PASSWORD ${literal} VALID UNTIL 'infinity'`);
    const role = await pool.query<{ safe: boolean }>(`SELECT NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls AS safe FROM pg_roles WHERE rolname='koneva_app'`);
    if (role.rows[0]?.safe !== true) throw new Error('Runtime database role failed its privilege check.');
  } finally { await pool.end(); }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Runtime database role setup failed.'}\n`);
  process.exitCode = 1;
});
