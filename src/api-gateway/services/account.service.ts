import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import pool, { transaction } from '../../shared/database/connection';
import type { Role } from '../../shared/permissions';
import type { TenantContext } from '../../shared/types/api';
import { ServiceError } from './service-error';
import { createTrial } from './billing.service';

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

async function createSession(db: Queryable, userId: string, meta: ClientMeta): Promise<{ token: string; expiresAt: Date }> {
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

export interface SignupInput { email: string; password: string; name: string; workspace_name?: string | undefined }

export async function signup(input: SignupInput, meta: ClientMeta): Promise<SessionResult> {
  const passwordHash = await hashPassword(input.password);
  const workspaceName = input.workspace_name ?? `Workspace ${input.name}`;
  try {
    return await transaction(async (client) => {
      const user = (await client.query<{ id: string }>(
        `INSERT INTO users (email, name, password_hash, terms_accepted_at, terms_version, last_login_at)
         VALUES ($1, $2, $3, now(), $4, now()) RETURNING id`,
        [input.email, input.name, passwordHash, TERMS_VERSION],
      )).rows[0]!;
      // The legacy tenant api_key column is required but never shown to the user;
      // access for new workspaces goes through sessions and scoped keys.
      const tenant = (await client.query<{ id: string }>(
        `INSERT INTO tenants (name, email, api_key, webhook_secret) VALUES ($1, $2, $3, $4) RETURNING id`,
        [workspaceName, input.email, `wg_${randomBytes(24).toString('hex')}`, `whsec_${randomBytes(24).toString('hex')}`],
      )).rows[0]!;
      // Limits and the trial period come from the 'trial' plan, so the operator can change them in one place.
      await createTrial(client, tenant.id);
      await client.query(`INSERT INTO memberships (user_id, tenant_id, role) VALUES ($1, $2, 'owner')`, [user.id, tenant.id]);
      const session = await createSession(client, user.id, meta);
      return {
        token: session.token, expires_at: session.expiresAt,
        user: { id: user.id, email: input.email, name: input.name },
        workspaces: [{ id: tenant.id, name: workspaceName, role: 'owner' as Role }],
      };
    });
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new ServiceError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
    }
    throw error;
  }
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
  const session = await createSession(pool, user.id, meta);
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
    `SELECT m.role, t.id, t.name, t.email, t.api_key, t.webhook_url, t.webhook_secret,
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
