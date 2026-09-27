// Offline recovery for a lost authenticator AND lost recovery codes, run by an accountable person with database access.
// Clears the operator's MFA, revokes every session and open challenge, forces re-enrollment with a NEW one-time enrollment
// code (valid 24 hours), and records the operation in operator_security_events with OPERATOR_ADMIN_LABEL.
import { z } from 'zod';
import { codeHash, newEnrollmentCode } from '../src/api-gateway/operator/mfa';
import { adminContext } from './lib/operator-admin';

async function main(): Promise<void> {
  const context = adminContext();
  let input = '';
  for await (const chunk of process.stdin) { input += String(chunk); if (Buffer.byteLength(input) > 1024) throw new Error('Input too large'); }
  const request = z.union([
    z.object({ email: z.string().trim().toLowerCase().email() }).strict(),
    z.object({ all: z.literal(true) }).strict(), // after a lost OPERATOR_MFA_ENC_KEY: every operator must enroll again
  ]).parse(JSON.parse(input));
  const { default: pool } = await import('../src/shared/database/connection');
  try {
    const client = await pool.connect();
    const issued: Array<{ email: string; code: string }> = [];
    try {
      await client.query('BEGIN');
      const rows = 'all' in request
        ? (await client.query<{ id: string; email: string }>('SELECT id, email FROM operators WHERE disabled_at IS NULL ORDER BY email FOR UPDATE')).rows
        : (await client.query<{ id: string; email: string }>('SELECT id, email FROM operators WHERE email=$1 FOR UPDATE', [request.email])).rows;
      if (rows.length === 0) throw new Error('unknown operator');
      for (const row of rows) {
        const code = newEnrollmentCode();
        await client.query('DELETE FROM operator_recovery_codes WHERE operator_id=$1', [row.id]);
        // The credential trigger also revokes sessions and closes challenges; done explicitly so the intent is visible.
        await client.query(`UPDATE operators SET mfa_secret_enc=NULL, mfa_enrolled_at=NULL, mfa_last_step=NULL,
          enrollment_code_hash=$2, enrollment_code_expires_at=now() + interval '24 hours' WHERE id=$1`, [row.id, codeHash(code)]);
        await client.query('UPDATE operator_sessions SET revoked_at=now() WHERE operator_id=$1 AND revoked_at IS NULL', [row.id]);
        await client.query('UPDATE operator_challenges SET consumed_at=now() WHERE operator_id=$1 AND consumed_at IS NULL', [row.id]);
        await client.query("INSERT INTO operator_security_events(event, operator_id, source, actor_label) VALUES ('mfa_reset',$1,'offline',$2)", [row.id, context.label]);
        issued.push({ email: row.email, code });
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    for (const { email, code } of issued) process.stdout.write(`MFA reset for ${email}. New enrollment code (shown once, valid 24 hours): ${code}\n`);
  } finally { await pool.end(); }
}
void main().catch(() => { process.stderr.write('MFA reset failed. Check explicit configuration (see docs/OPERATOR_PANEL.md) and the email.\n'); process.exitCode = 1; });
