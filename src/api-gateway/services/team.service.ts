import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import pool, { transaction } from '../../shared/database/connection';
import type { Role } from '../../shared/permissions';
import { TERMS_VERSION, hashPassword, newSessionToken, sha256, type SessionResult } from './account.service';
import { ServiceError } from './service-error';
import { assertCanAddMember } from './billing.service';

export const INVITABLE_ROLES = ['admin', 'developer', 'viewer'] as const;
export const INVITE_HOURS = 48;
const MAX_PENDING = 50;

export const newInviteToken = (): { token: string; hash: string } => {
  const token = `wgi_${randomBytes(32).toString('base64url')}`;
  return { token, hash: sha256(token) };
};

/** Owners grant any role; admins may only grant developer and viewer. */
export function canGrant(actor: Role, target: Role): boolean {
  if (actor === 'owner') return true;
  if (actor === 'admin') return target === 'developer' || target === 'viewer';
  return false;
}

/** Whether `actor` may change or remove someone who currently holds `current`. */
export function canManageMember(actor: Role, current: Role): boolean {
  if (actor === 'owner') return true;
  if (actor === 'admin') return current === 'developer' || current === 'viewer';
  return false;
}

export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

export async function createInvitation(
  tenantId: string, inviter: { userId: string; role: Role }, input: { email: string; role: Role },
): Promise<{ id: string; email: string; role: Role; expires_at: Date; token: string; accept_path: string }> {
  if (!(INVITABLE_ROLES as readonly string[]).includes(input.role)) {
    throw new ServiceError(400, 'INVALID_ROLE', 'Invite as admin, developer or viewer. Ownership is transferred separately.');
  }
  if (!canGrant(inviter.role, input.role)) {
    throw new ServiceError(403, 'ROLE_NOT_GRANTABLE', `Your role cannot invite a ${input.role}`);
  }
  await assertCanAddMember(tenantId);
  const existing = await pool.query(
    `SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = $1 AND lower(u.email) = lower($2)`,
    [tenantId, input.email],
  );
  if (existing.rows.length > 0) throw new ServiceError(409, 'ALREADY_MEMBER', 'This person is already in the workspace');

  const pending = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM invitations WHERE tenant_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
    [tenantId],
  );
  if ((pending.rows[0]?.n ?? 0) >= MAX_PENDING) throw new ServiceError(409, 'INVITE_LIMIT', 'Too many pending invitations');

  // A new invitation replaces any earlier one for the same email, so only one link is ever live.
  await pool.query(
    `UPDATE invitations SET revoked_at = now() WHERE tenant_id = $1 AND lower(email) = lower($2) AND accepted_at IS NULL AND revoked_at IS NULL`,
    [tenantId, input.email],
  );
  const { token, hash } = newInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_HOURS * 3_600_000);
  const row = (await pool.query<{ id: string }>(
    `INSERT INTO invitations (tenant_id, email, role, token_hash, invited_by, expires_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [tenantId, input.email, input.role, hash, inviter.userId, expiresAt],
  )).rows[0]!;
  return { id: row.id, email: input.email, role: input.role, expires_at: expiresAt, token, accept_path: `/invite/${token}` };
}

export async function listTeam(tenantId: string) {
  const members = (await pool.query(
    `SELECT u.id AS user_id, u.name, u.email, m.role, m.created_at AS joined_at, u.last_login_at
     FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = $1 ORDER BY m.created_at`,
    [tenantId],
  )).rows;
  const invitations = (await pool.query(
    `SELECT id, email, role, expires_at, created_at FROM invitations
     WHERE tenant_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC`,
    [tenantId],
  )).rows;
  return { members, invitations };
}

export async function revokeInvitation(tenantId: string, id: string): Promise<void> {
  const result = await pool.query(
    `UPDATE invitations SET revoked_at = now() WHERE id = $1 AND tenant_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id`,
    [id, tenantId],
  );
  if (result.rows.length === 0) throw new ServiceError(404, 'INVITATION_NOT_FOUND', 'Invitation not found');
}

const INVALID = () => new ServiceError(404, 'INVITATION_INVALID', 'This invitation is invalid, expired or already used');

export async function previewInvitation(token: string) {
  const row = (await pool.query<{ email: string; role: Role; expires_at: Date; workspace: string; inviter: string | null }>(
    `SELECT i.email, i.role, i.expires_at, t.name AS workspace, u.name AS inviter
     FROM invitations i JOIN tenants t ON t.id = i.tenant_id LEFT JOIN users u ON u.id = i.invited_by
     WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()`,
    [sha256(token)],
  )).rows[0];
  if (!row) throw INVALID();
  return { workspace: row.workspace, role: row.role, invited_by: row.inviter, email_hint: maskEmail(row.email), expires_at: row.expires_at };
}

export interface AcceptInput {
  session?: { userId: string; email: string } | undefined;
  newUser?: { name: string; password: string } | undefined;
  meta: { ip?: string | undefined; userAgent?: string | undefined };
}
export type AcceptResult =
  | { joined: { id: string; name: string; role: Role }; session?: SessionResult };

export async function acceptInvitation(token: string, input: AcceptInput): Promise<AcceptResult & { tenantId: string; userId: string }> {
  const passwordHash = input.newUser ? await hashPassword(input.newUser.password) : undefined;
  return transaction(async (client: PoolClient) => {
    const invite = (await client.query<{ id: string; tenant_id: string; email: string; role: Role; workspace: string }>(
      `SELECT i.id, i.tenant_id, i.email, i.role, t.name AS workspace
       FROM invitations i JOIN tenants t ON t.id = i.tenant_id
       WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now() FOR UPDATE OF i`,
      [sha256(token)],
    )).rows[0];
    if (!invite) throw INVALID();

    let userId: string;
    let created: { name: string } | undefined;
    if (input.session) {
      if (input.session.email.toLowerCase() !== invite.email.toLowerCase()) {
        throw new ServiceError(403, 'EMAIL_MISMATCH', 'This invitation was sent to a different email address');
      }
      userId = input.session.userId;
    } else {
      const existing = await client.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [invite.email]);
      if (existing.rows.length > 0) {
        throw new ServiceError(409, 'ACCOUNT_EXISTS', 'An account with this email already exists. Sign in, then accept the invitation.');
      }
      if (!input.newUser || !passwordHash) throw new ServiceError(400, 'MISSING_ACCOUNT_DETAILS', 'Name, password and acceptance of the terms are required');
      userId = (await client.query<{ id: string }>(
        `INSERT INTO users (email, name, password_hash, terms_accepted_at, terms_version, last_login_at) VALUES ($1, $2, $3, now(), $4, now()) RETURNING id`,
        [invite.email, input.newUser.name, passwordHash, TERMS_VERSION],
      )).rows[0]!.id;
      created = { name: input.newUser.name };
    }

    try {
      await client.query(`INSERT INTO memberships (user_id, tenant_id, role) VALUES ($1, $2, $3)`, [userId, invite.tenant_id, invite.role]);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ServiceError(409, 'ALREADY_MEMBER', 'You are already in this workspace');
      throw error;
    }
    await client.query(`UPDATE invitations SET accepted_at = now(), accepted_by = $2 WHERE id = $1`, [invite.id, userId]);

    const joined = { id: invite.tenant_id, name: invite.workspace, role: invite.role };
    if (!created) return { joined, tenantId: invite.tenant_id, userId };
    const { token: sessionToken, hash } = newSessionToken();
    const expiresAt = new Date(Date.now() + 14 * 86_400_000);
    await client.query(
      `INSERT INTO user_sessions (user_id, token_hash, expires_at, ip, user_agent) VALUES ($1, $2, $3, $4, $5)`,
      [userId, hash, expiresAt, input.meta.ip?.slice(0, 64) ?? null, input.meta.userAgent?.slice(0, 200) ?? null],
    );
    return {
      joined, tenantId: invite.tenant_id, userId,
      session: { token: sessionToken, expires_at: expiresAt, user: { id: userId, email: invite.email, name: created.name }, workspaces: [joined] },
    };
  });
}

export async function changeMemberRole(tenantId: string, actor: { userId: string; role: Role }, targetUserId: string, newRole: Role): Promise<void> {
  if (actor.userId === targetUserId) throw new ServiceError(400, 'CANNOT_CHANGE_SELF', 'You cannot change your own role');
  const target = (await pool.query<{ role: Role }>('SELECT role FROM memberships WHERE tenant_id = $1 AND user_id = $2', [tenantId, targetUserId])).rows[0];
  if (!target) throw new ServiceError(404, 'MEMBER_NOT_FOUND', 'Member not found');
  if (!canManageMember(actor.role, target.role) || !canGrant(actor.role, newRole)) {
    throw new ServiceError(403, 'ROLE_NOT_GRANTABLE', 'Your role cannot make this change');
  }
  await pool.query('UPDATE memberships SET role = $3 WHERE tenant_id = $1 AND user_id = $2', [tenantId, targetUserId, newRole]);
}

export async function removeMember(tenantId: string, actor: { userId: string; role: Role }, targetUserId: string): Promise<void> {
  if (actor.userId === targetUserId) throw new ServiceError(400, 'CANNOT_REMOVE_SELF', 'You cannot remove yourself');
  const target = (await pool.query<{ role: Role }>('SELECT role FROM memberships WHERE tenant_id = $1 AND user_id = $2', [tenantId, targetUserId])).rows[0];
  if (!target) throw new ServiceError(404, 'MEMBER_NOT_FOUND', 'Member not found');
  if (!canManageMember(actor.role, target.role)) throw new ServiceError(403, 'ROLE_NOT_GRANTABLE', 'Your role cannot remove this member');
  await pool.query('DELETE FROM memberships WHERE tenant_id = $1 AND user_id = $2', [tenantId, targetUserId]);
  // Their sessions stay valid for other workspaces, but this workspace no longer resolves for them.
}
