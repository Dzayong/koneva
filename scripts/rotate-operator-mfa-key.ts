// Offline rotation of OPERATOR_MFA_ENC_KEY. Re-seals every stored TOTP secret from the OLD key to the NEW key in ONE transaction,
// closes open challenges and (by the credential trigger) revokes every operator session, and records 'mfa_key_rotated'.
// Keys come from OPERATOR_MFA_ENC_KEY_OLD / OPERATOR_MFA_ENC_KEY_NEW in the environment; they are never printed or written.
// Nothing is changed if any secret does not open with the OLD key. Then deploy with OPERATOR_MFA_ENC_KEY=<the NEW key>.
import { adminContext } from './lib/operator-admin';
import { decryptSecret, encryptSecret } from '../src/api-gateway/operator/mfa';

function readKey(name: string): Buffer {
  const raw = process.env[name] ?? '';
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32 || key.toString('base64') !== raw) throw new Error(`${name} must be base64 of exactly 32 bytes`);
  return key;
}

async function main(): Promise<void> {
  const context = adminContext();
  const oldKey = readKey('OPERATOR_MFA_ENC_KEY_OLD'), newKey = readKey('OPERATOR_MFA_ENC_KEY_NEW');
  if (oldKey.equals(newKey)) throw new Error('OLD and NEW keys are identical');
  const { default: pool } = await import('../src/shared/database/connection');
  try {
    const client = await pool.connect();
    let count = 0;
    try {
      await client.query('BEGIN');
      const rows = (await client.query<{ id: string; mfa_secret_enc: string }>('SELECT id, mfa_secret_enc FROM operators WHERE mfa_secret_enc IS NOT NULL ORDER BY id FOR UPDATE')).rows;
      for (const row of rows) {
        const plain = decryptSecret(oldKey, row.mfa_secret_enc, row.id); // throws (and rolls back) if the OLD key is wrong
        await client.query('UPDATE operators SET mfa_secret_enc=$2 WHERE id=$1', [row.id, encryptSecret(newKey, plain, row.id)]);
        count += 1;
      }
      await client.query('UPDATE operator_challenges SET consumed_at=now() WHERE consumed_at IS NULL');
      await client.query("UPDATE operator_sessions SET revoked_at=now() WHERE revoked_at IS NULL");
      await client.query("INSERT INTO operator_security_events(event, source, actor_label) VALUES ('mfa_key_rotated','offline',$1)", [context.label]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    process.stdout.write(`Re-sealed ${count} secret(s). All operator sessions were ended. Deploy with OPERATOR_MFA_ENC_KEY set to the NEW key.\n`);
  } finally { await pool.end(); }
}
void main().catch(() => { process.stderr.write('Rotation failed and nothing was changed. Check both keys, the database and OPERATOR_ADMIN_LABEL (docs/OPERATOR_PANEL.md).\n'); process.exitCode = 1; });
