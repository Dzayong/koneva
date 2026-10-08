// Offline provisioning for an Owner account — the only path that sets is_owner=true.
// Permissions are fixed (full set including owner:insights); the caller supplies email, name, and password.
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { adminContext } from './lib/operator-admin';

const ownerPermissions = ['payments:read','payments:confirm','students:read','students:decide','workspaces:read','audit:read','owner:insights'] as const;

async function main(): Promise<void> {
  const context = adminContext();
  const schema = z.object({
    email: z.string().trim().toLowerCase().email().max(255),
    name: z.string().trim().min(1).max(120),
    password: z.string().min(12).refine((value) => Buffer.byteLength(value, 'utf8') <= 72),
  }).strict();
  let input = '';
  for await (const chunk of process.stdin) {
    input += String(chunk);
    if (Buffer.byteLength(input) > 4096) throw new Error('Input too large');
  }
  const operator = schema.parse(JSON.parse(input));
  const passwordHash = await bcrypt.hash(operator.password, 12);
  const { default: pool } = await import('../src/shared/database/connection');
  try {
    const client = await pool.connect();
    let id: string;
    try {
      await client.query('BEGIN');
      id = (await client.query<{ id: string }>(
        `INSERT INTO operators(email,name,password_hash,permissions,is_owner)
         VALUES ($1,$2,$3,$4,true) RETURNING id`,
        [operator.email, operator.name, passwordHash, [...ownerPermissions]],
      )).rows[0]!.id;
      await client.query("INSERT INTO operator_security_events(event,operator_id,source,actor_label) VALUES ('operator_provisioned',$1,'offline',$2)", [id, context.label]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    process.stdout.write(`Created Owner operator ${id} (is_owner=true, full permissions).\n`);
    process.stdout.write('Store the password offline; do not paste any credential into chat.\n');
  } finally { await pool.end(); }
}

void main().catch(() => {
  process.stderr.write('Owner provisioning failed. Check explicit configuration (docs/OPERATOR_PANEL.md), migration, unique email, and whether an Owner account already exists.\n');
  process.exitCode = 1;
});
