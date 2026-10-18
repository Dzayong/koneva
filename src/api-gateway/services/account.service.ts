import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import pool, { transaction } from '../../shared/database/connection';
import type { Role } from '../../shared/permissions';
import type { TenantContext } from '../../shared/types/api';
import { ServiceError } from './service-error';
import { createTrial } from './billing.service';
import { recordSystemNotification } from './system-notification-outbox';

const BCRYPT_COST = 12;
const SESSION_DAYS = 14;
const TOUCH_AFTER_MS = 5 * 60_000;
export const TERMS_VERSION = '2026-09';

// Compared against when the email is unknown, so "no such user" and "wrong password"
// take the same time and cannot be told apart.
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer', BCRYPT_COST);

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export function newSessionToken(): { token: string; hash: string } {
  const token = `wgs_${randomBytes(32).toString('base64url')}`;
  return { token, hash: sha256(token) };
}

export const hashPassword = (password: string): Promise<string> => bcrypt.hash(password, BCRYPT_COST);

export async function verifyPassword(password: string, hash: string | undefined): Promise<boolean> {
  const ok = await bcrypt.compare(password, hash ?? DUMMY_HASH);
  return hash !== undefined && ok;
}

export interface ClientMeta { ip?: string | undefined; userAgent?: string | undefined }
export interface Workspace { id: string; name: string; role: Role }
export interface SessionResult {
  token: string;
  expires_at: Date;
  user: { id: string; email: string; name: string };
  workspaces: Workspace[];
}

type Queryable = Pick<PoolClient, 'query'> | typeof pool;

async function issueSessionToken(db: Queryable, userId: string, meta: ClientMeta): Promise<{ token: string; expiresAt: Date }> {
  const { token, hash } = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.query(
    `INSERT INTO user_sessions (user_id, token_hash, expires_at, ip, user_agent) VALUES ($1, $2, $3, $4, $5)`,
    [userId, hash, expiresAt, meta.ip?.slice(0, 64) ?? null, meta.userAgent?.slice(0, 200) ?? null],
  );
  return { token, expiresAt };
}

async function listWorkspaces(db: Queryable, userId: string): Promise<Workspace[]> {
  const { rows } = await db.query<{ id: string; name: string; role: Role }>(
    `SELECT t.id, t.name, m.role FROM memberships m JOIN tenants t ON t.id = m.tenant_id
     WHERE m.user_id = $1 AND t.status = 'active' ORDER BY m.created_at`,
    [userId],
  );
  return rows;
}

export interface SignupInput {
  email: string; password: string; name: string; workspace_name?: string | undefined;
  verification_method?: 'email' | 'whatsapp' | undefined; phone_number?: string | undefined;
}

export interface PendingSignup { user_id: string; email: string }

export function normalizeSignupPhone(value: string): string {
  let digits = value.replace(/[^0-9]/g, '');
  if (digits.startsWith('0062')) digits = digits.slice(2);
  if (digits.startsWith('620')) digits = `62${digits.slice(3)}`;
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith('8')) digits = `62${digits}`;
  if (!digits.startsWith('62') || digits.length < 10 || digits.length > 15) {
    throw new ServiceError(400, 'INVALID_PHONE_NUMBER', 'Masukkan nomor WhatsApp Indonesia yang valid.');
  }
  return digits;
}

/** Reserve only a non-authenticating pending record. No workspace, trial, or session exists until mailbox proof succeeds. */
export async function signup(input: SignupInput): Promise<PendingSignup> {
  const passwordHash = await hashPassword(input.password);
  const workspaceName = input.workspace_name ?? `Workspace ${input.name}`;
  const verificationMethod = input.verification_method ?? 'email';
  const pendingPhone = verificationMethod === 'whatsapp' && input.phone_number ? normalizeSignupPhone(input.phone_number) : null;
  try {
    return await transaction(async (client) => {
      const existing = (await client.query<{ id: string; status: string; email_verified_at: Date | null }>(
        'SELECT id, status, email_verified_at FROM users WHERE lower(email) = lower($1) FOR UPDATE', [input.email],
      )).rows[0];
      if (existing && (existing.status !== 'pending_email' || existing.email_verified_at)) {
        throw new ServiceError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
      }
      const user = existing
        ? (await client.query<{ id: string }>(
          `UPDATE users SET name=$2, password_hash=$3, pending_signup_workspace_name=$4,
             pending_signup_phone_number=$5, pending_signup_verification_method=$6,
             terms_accepted_at=now(), terms_version=$7
           WHERE id=$1 RETURNING id`,
          [existing.id, input.name, passwordHash, workspaceName, pendingPhone, verificationMethod, TERMS_VERSION],
        )).rows[0]!
        : (await client.query<{ id: string }>(
          `INSERT INTO users (email, name, password_hash, status, pending_signup_workspace_name,
             pending_signup_phone_number, pending_signup_verification_method, terms_accepted_at, terms_version)
           VALUES ($1, $2, $3, 'pending_email', $4, $5, $6, now(), $7) RETURNING id`,
          [input.email, input.name, passwordHash, workspaceName, pendingPhone, verificationMethod, TERMS_VERSION],
        )).rows[0]!;
      // A pending signup restart may happen during the resend cooldown. Keep its still-valid proof
      // so the owner can verify the mailbox/phone while the pending name/password are refreshed.
      return { user_id: user.id, email: input.email };
    });
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new ServiceError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
    }
    throw error;
  }
}

/** Activate one pending signup only inside the verified-OTP transaction. */
export async function activatePendingSignup(client: PoolClient, userId: string, meta: ClientMeta, method: 'email' | 'whatsapp' = 'email'): Promise<SessionResult> {
  const user = (await client.query<{ email: string; name: string; workspace_name: string }>(
    `SELECT email, name, pending_signup_workspace_name AS workspace_name FROM users
     WHERE id=$1 AND status='pending_email' AND
       (($2 = 'email' AND email_verified_at IS NOT NULL) OR ($2 = 'whatsapp' AND phone_verified_at IS NOT NULL)) FOR UPDATE`, [userId, method],
  )).rows[0];
  if (!user) throw new ServiceError(409, 'SIGNUP_STATE_INVALID', 'Pendaftaran tidak dapat diaktifkan.');

  // No static tenant API key is issued any more (decision 2026-10-02: removed entirely). Integrations use
  // scoped wgk_ keys created from the dashboard by a signed-in person.
  const tenant = (await client.query<{ id: string }>(
    `INSERT INTO tenants (name, email, webhook_secret) VALUES ($1, $2, $3) RETURNING id`,
    [user.workspace_name, user.email, `whsec_${randomBytes(24).toString('hex')}`],
  )).rows[0]!;
  await recordSystemNotification(client, `signup.created:${tenant.id}`, 'signup.created', `Signup baru KONEVA: workspace ${user.workspace_name}.`);
  await createTrial(client, tenant.id);
  await client.query(`INSERT INTO memberships (user_id, tenant_id, role) VALUES ($1, $2, 'owner')`, [userId, tenant.id]);
  await client.query("UPDATE users SET status='active', pending_signup_workspace_name=NULL, pending_signup_phone_number=NULL, pending_signup_verification_method='email', last_login_at=now() WHERE id=$1", [userId]);
  const session = await issueSessionToken(client, userId, meta);
  return {
    token: session.token, expires_at: session.expiresAt,
    user: { id: userId, email: user.email, name: user.name },
    workspaces: [{ id: tenant.id, name: user.workspace_name, role: 'owner' as Role }],
  };
}

export async function login(email: string, password: string, meta: ClientMeta): Promise<SessionResult> {
  const { rows } = await pool.query<{ id: string; email: string; name: string; password_hash: string; status: string }>(
    `SELECT id, email, name, password_hash, status FROM users WHERE lower(email) = lower($1)`,
    [email],
  );
  const user = rows[0];
  const ok = await verifyPassword(password, user?.password_hash);
  if (!user || !ok || user.status !== 'active') {
    throw new ServiceError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }
  const session = await issueSessionToken(pool, user.id, meta);
  await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  return {
    token: session.token, expires_at: session.expiresAt,
    user: { id: user.id, email: user.email, name: user.name },
    workspaces: await listWorkspaces(pool, user.id),
  };
}

export async function revokeSession(token: string): Promise<void> {
  await pool.query('UPDATE user_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [sha256(token)]);
}

export interface ResolvedSession {
  sessionId: string;
  user: { id: string; email: string; name: string; email_verified: boolean };
  tenant: TenantContext;
  role: Role;
  workspaces: Workspace[];
}

export async function resolveSession(token: string, workspaceId?: string): Promise<ResolvedSession | undefined> {
  const hash = sha256(token);
  const { rows } = await pool.query<{
    session_id: string; expires_at: Date; last_used_at: Date | null;
    user_id: string; email: string; name: string; user_status: string; email_verified_at: Date | null;
  }>(
    `SELECT s.id AS session_id, s.expires_at, s.last_used_at, u.id AS user_id, u.email, u.name, u.status AS user_status, u.email_verified_at
     FROM user_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [hash],
  );
  const session = rows[0];
  if (!session || session.user_status !== 'active') return undefined;

  const memberships = (await pool.query<TenantContext & { role: Role }>(
    `SELECT m.role, t.id, t.name, t.email, t.webhook_url, t.webhook_secret,
            t.max_devices, t.quota_messages, t.used_messages, t.status
     FROM memberships m JOIN tenants t ON t.id = m.tenant_id
     WHERE m.user_id = $1 AND t.status = 'active' ORDER BY m.created_at`,
    [session.user_id],
  )).rows;
  const chosen = workspaceId ? memberships.find((m) => m.id === workspaceId) : memberships[0];
  if (!chosen) return undefined;

  if (!session.last_used_at || Date.now() - new Date(session.last_used_at).getTime() > TOUCH_AFTER_MS) {
    // Sliding expiry: an active person is not logged out mid-work.
    await pool.query(
      `UPDATE user_sessions SET last_used_at = now(), expires_at = now() + make_interval(days => $2::int) WHERE id = $1`,
      [session.session_id, SESSION_DAYS],
    );
  }
  const { role, ...tenant } = chosen;
  return {
    sessionId: session.session_id,
    user: { id: session.user_id, email: session.email, name: session.name, email_verified: session.email_verified_at !== null },
    tenant: tenant as TenantContext,
    role,
    workspaces: memberships.map((m) => ({ id: m.id, name: m.name, role: m.role })),
  };
}

/** Attach a person as owner of an existing workspace (used to bring pre-existing tenants into the console). */
export async function createOwnerForTenant(tenantId: string, input: SignupInput): Promise<{ user_id: string }> {
  const passwordHash = await hashPassword(input.password);
  try {
    return await transaction(async (client) => {
      const tenant = await client.query('SELECT 1 FROM tenants WHERE id = $1', [tenantId]);
      if (tenant.rows.length === 0) throw new ServiceError(404, 'TENANT_NOT_FOUND', 'Tenant not found');
      const user = (await client.query<{ id: string }>(
        `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id`,
        [input.email, input.name, passwordHash],
      )).rows[0]!;
      await client.query(`INSERT INTO memberships (user_id, tenant_id, role) VALUES ($1, $2, 'owner')`, [user.id, tenantId]);
      return { user_id: user.id };
    });
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new ServiceError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
    throw error;
  }
}
