// Owner-run offline provisioning for the single minimum-scope emergency Operator account.
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { codeHash, newEnrollmentCode } from '../src/api-gateway/operator/mfa';
import { adminContext } from './lib/operator-admin';

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
    const enrollmentCode = newEnrollmentCode();
    const client = await pool.connect();
    let id: string;
    try {
      await client.query('BEGIN');
      const existing = await client.query<{ id: string }>('SELECT id FROM operators WHERE is_break_glass FOR UPDATE');
      if (existing.rowCount) throw new Error('An emergency Operator account already exists.');
      id = (await client.query<{ id: string }>(
        `INSERT INTO operators(email,name,password_hash,permissions,is_break_glass,enrollment_code_hash,enrollment_code_expires_at)
         VALUES ($1,$2,$3,ARRAY['audit:read']::text[],true,$4,now()+interval '24 hours') RETURNING id`,
        [operator.email, operator.name, passwordHash, codeHash(enrollmentCode)],
      )).rows[0]!.id;
      await client.query("INSERT INTO operator_security_events(event,operator_id,source,actor_label) VALUES ('break_glass_provisioned',$1,'offline',$2)", [id, context.label]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    process.stdout.write(`Created minimum-scope emergency Operator ${id} (audit:read only).\n`);
    process.stdout.write(`Enrollment code (shown once, expires in 24 hours): ${enrollmentCode}\n`);
    process.stdout.write('Store the password and MFA recovery codes offline; do not paste any credential into chat.\n');
  } finally { await pool.end(); }
}

void main().catch(() => {
  process.stderr.write('Break-glass provisioning failed. Check explicit configuration (docs/OPERATOR_PANEL.md), migration, unique email, and whether an emergency account already exists.\n');
  process.exitCode = 1;
});
