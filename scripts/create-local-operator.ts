// Offline provisioning by a person with database access; no web bootstrap, no default account or password, no ADMIN_API_KEY shortcut.
// Every run is recorded in operator_security_events with the accountable OPERATOR_ADMIN_LABEL. See docs/OPERATOR_PANEL.md.
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { codeHash, newEnrollmentCode } from '../src/api-gateway/operator/mfa';
import { adminContext } from './lib/operator-admin';

async function main(): Promise<void> {
  const context = adminContext();
  const schema = z.object({
    email: z.string().trim().toLowerCase().email().max(255), name: z.string().trim().min(1).max(120),
    password: z.string().min(12).refine((v) => Buffer.byteLength(v,'utf8') <= 72),
    // Owner insights can only be granted by the dedicated owner-only provisioning path.
    permissions: z.array(z.enum(['payments:read','payments:confirm','students:read','students:decide','workspaces:read','audit:read'])).min(1),
  }).strict();
  let input = '';
  for await (const chunk of process.stdin) {
    input += String(chunk);
    if (Buffer.byteLength(input) > 4096) throw new Error('Input too large');
  }
  const operator = schema.parse(JSON.parse(input));
  const passwordHash = await bcrypt.hash(operator.password,12);
  // Import only after explicit local safety checks; never use a fallback .env connection.
  const { default: pool } = await import('../src/shared/database/connection');
  try {
    // One-time enrollment code: the operator needs it (plus the password) to set up MFA on first sign-in.
    const enrollmentCode = newEnrollmentCode();
    const client = await pool.connect();
    let row: { id: string };
    try {
      await client.query('BEGIN');
      row = (await client.query<{ id: string }>(
        `INSERT INTO operators(email,name,password_hash,permissions,enrollment_code_hash,enrollment_code_expires_at)
         VALUES ($1,$2,$3,$4,$5, now() + interval '24 hours') RETURNING id`,
        [operator.email,operator.name,passwordHash,operator.permissions,codeHash(enrollmentCode)],
      )).rows[0]!;
      await client.query("INSERT INTO operator_security_events(event, operator_id, source, actor_label) VALUES ('operator_provisioned',$1,'offline',$2)", [row.id, context.label]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    process.stdout.write(`Created local operator ${row.id}\nEnrollment code (shown once, valid 24 hours): ${enrollmentCode}\n`);
  } finally { await pool.end(); }
}
void main().catch(() => { process.stderr.write('Operator creation failed. Check explicit configuration (see docs/OPERATOR_PANEL.md), input, migration, and email uniqueness.\n'); process.exitCode=1; });
