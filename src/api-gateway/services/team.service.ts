import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import config from '../../shared/config';
import pool, { transaction } from '../../shared/database/connection';
import { ASSIGNABLE_ROLES, type Role } from '../../shared/permissions';
import { legacyRoleDaysRemaining, legacyRoleTransitionPhase } from '../../shared/legacy-role-transition';
import { TERMS_VERSION, hashPassword, newSessionToken, sha256, type SessionResult } from './account.service';
import { ServiceError } from './service-error';
import { assertCanAddMember } from './billing.service';
import { emailAvailable, requireEmail, sendInvitationOtp } from './mailer';
import { reserveIpRequest, reserveOtpSend, reserveWhatsappOtpSend } from './otp-limits';
import { queueSystemOtp } from './message.service';
import logger from '../../shared/utils/logger';

async function assertMaxOneCs(tenantId: string, excludeUserId?: string): Promise<void> {
  const exclude = excludeUserId ? ` AND user_id <> '${excludeUserId}'` : '';
  const active = (await pool.query<{ n: number }>(
    `SELECT (
       (SELECT count(*) FROM memberships WHERE tenant_id=$1 AND role='cs'${exclude})
       + (SELECT count(*) FROM invitations WHERE tenant_id=$1 AND role='cs' AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now())
     )::int AS n`, [tenantId],
  )).rows[0]?.n ?? 0;
  if (active >= 1) {
    throw new ServiceError(409, 'CS_LIMIT_REACHED', 'Workspace saat ini dibatasi satu akun CS aktif. Keluarkan CS yang ada atau batalkan undangan CS sebelum menambah yang baru.');
  }
}

/** Developer handles integrations; CS is restricted to Inbox. Owner is never invited; admin/viewer are legacy. */
export const INVITABLE_ROLES = ASSIGNABLE_ROLES;
export const INVITE_HOURS = 48;
export const OTP_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_SECONDS = 60;

/**
 * Invitations go to the Gmail address the person will use for their KONEVA account. Whitespace and letter case are
 * normalised; NOTHING else is (no dot or +tag folding, googlemail.com is refused), so the address stored, the address the
 * OTP goes to, and the address they sign up/sign in with are the same string.
 * CS invitations accept any valid email (not just Gmail) — identity is verified via WhatsApp OTP.
 */
export function normalizeInviteEmail(raw: string, role?: Role): string {
  const email = raw.trim().toLowerCase();
  if (role === 'cs') {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 255) {
      throw new ServiceError(400, 'INVALID_EMAIL', 'Masukkan alamat email yang valid untuk akun CS.');
    }
    return email;
  }
  if (!/^[^@\s]+@gmail\.com$/.test(email) || email.length > 255) {
    throw new ServiceError(400, 'GMAIL_REQUIRED', 'Undangan hanya untuk alamat Gmail (@gmail.com), yaitu alamat yang akan dipakai penerima di KONEVA.');
  }
  return email;
}

export function normalizeInvitePhone(raw: string): string {
  let digits = raw.replace(/[^0-9]/g, '');
  if (digits.startsWith('0062')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith('8')) digits = `62${digits}`;
  if (!/^62[0-9]{8,13}$/.test(digits)) {
    throw new ServiceError(400, 'INVALID_PHONE', 'Masukkan nomor WhatsApp Indonesia yang valid (contoh: 08123456789).');
  }
  return digits;
}

const otpHash = (invitationId: string, code: string): string =>
  createHmac('sha256', config.jwt.secret).update(`invitation-otp-v1:${invitationId}:${code}`).digest('hex');
const MAX_PENDING = 50;

export const newInviteToken = (): { token: string; hash: string } => {
  const token = `wgi_${randomBytes(32).toString('base64url')}`;
  return { token, hash: sha256(token) };
};

/** Only the workspace owner hands out access. */
export function canGrant(actor: Role, target: Role): boolean {
  return actor === 'owner' && (INVITABLE_ROLES as readonly string[]).includes(target);
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
  tenantId: string, inviter: { userId: string; role: Role }, input: { email: string; role: Role; device_keys?: string[] | undefined; phone?: string | undefined },
): Promise<{ id: string; email: string; role: Role; expires_at: Date; token: string; accept_path: string }> {
  if (!(INVITABLE_ROLES as readonly string[]).includes(input.role)) {
    throw new ServiceError(400, 'INVALID_ROLE', 'Undangan hanya untuk peran Developer atau Customer Service.');
  }
  if (!canGrant(inviter.role, input.role)) {
    throw new ServiceError(403, 'ROLE_NOT_GRANTABLE', 'Hanya Owner workspace yang bisa mengundang.');
  }
  input = { ...input, email: normalizeInviteEmail(input.email, input.role) };
  const phone = input.role === 'cs' ? normalizeInvitePhone(input.phone ?? '') : null;
  if (input.role === 'cs' && !phone) {
    throw new ServiceError(400, 'PHONE_REQUIRED', 'Nomor WhatsApp wajib diisi untuk undangan CS.');
  }
  const deviceIds = input.role === 'cs' ? await resolveDeviceGrants(tenantId, input.device_keys ?? []) : [];
  if (input.role === 'cs') await assertMaxOneCs(tenantId);
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
    `INSERT INTO invitations (tenant_id, email, role, token_hash, invited_by, expires_at, device_ids, phone) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [tenantId, input.email, input.role, hash, inviter.userId, expiresAt, deviceIds, phone],
  )).rows[0]!;
  return { id: row.id, email: input.email, role: input.role, expires_at: expiresAt, token, accept_path: `/invite/${token}` };
}

export async function listTeam(tenantId: string) {
  const members = (await pool.query(
    `SELECT u.id AS user_id, u.name, u.email, m.role, m.created_at AS joined_at, u.last_login_at,
       ARRAY(SELECT d.device_key FROM devices d WHERE d.tenant_id=m.tenant_id AND d.id=ANY(m.device_ids) AND d.status<>'deleted' ORDER BY d.device_key) AS device_keys
     FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = $1 ORDER BY m.created_at`,
    [tenantId],
  )).rows;
  const invitations = (await pool.query(
    `SELECT id, email, role, phone, expires_at, created_at FROM invitations
     WHERE tenant_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC`,
    [tenantId],
  )).rows;
  const legacyMemberCount = members.filter((m) => m.role === 'admin' || m.role === 'viewer').length;
  const notice = (await pool.query<{ notice_sent_at: Date; deadline_at: Date }>(
    `SELECT notice_sent_at, deadline_at FROM legacy_role_notices WHERE tenant_id = $1`, [tenantId],
  )).rows[0];
  const phase = legacyRoleTransitionPhase({
    legacyMemberCount,
    noticeSentAt: notice?.notice_sent_at ?? null,
    deadlineAt: notice?.deadline_at ?? null,
  }, new Date());
  return {
    members,
    devices: (await pool.query("SELECT device_key, label, phone_number FROM devices WHERE tenant_id=$1 AND status<>'deleted' ORDER BY label NULLS LAST, device_key", [tenantId])).rows,
    invitations,
    legacy_role_transition: {
      phase,
      legacy_member_count: legacyMemberCount,
      notice_sent_at: notice?.notice_sent_at ?? null,
      deadline_at: notice?.deadline_at ?? null,
      days_remaining: notice ? legacyRoleDaysRemaining(notice.deadline_at, new Date()) : null,
    },
  };
}

export async function issueLegacyRoleNotice(
  tenantId: string,
  actor: { userId: string; role: Role },
): Promise<{ created: boolean; notice_sent_at: Date; deadline_at: Date }> {
  if (actor.role !== 'owner') throw new ServiceError(403, 'ROLE_NOT_GRANTABLE', 'Hanya Owner yang dapat menerbitkan pemberitahuan transisi peran.');
  return transaction(async (client) => {
    const workspace = await client.query('SELECT id FROM tenants WHERE id = $1 FOR UPDATE', [tenantId]);
    if (!workspace.rowCount) throw new ServiceError(404, 'WORKSPACE_NOT_FOUND', 'Workspace tidak ditemukan.');
    const existing = (await client.query<{ notice_sent_at: Date; deadline_at: Date }>(
      `SELECT notice_sent_at, deadline_at FROM legacy_role_notices WHERE tenant_id = $1`, [tenantId],
    )).rows[0];
    if (existing) return { created: false, ...existing };
    const legacy = await client.query("SELECT 1 FROM memberships WHERE tenant_id = $1 AND role IN ('admin','viewer') LIMIT 1", [tenantId]);
    if (!legacy.rowCount) throw new ServiceError(409, 'NO_LEGACY_MEMBERS', 'Workspace ini tidak memiliki anggota Admin/Viewer lama.');
    const notice = (await client.query<{ notice_sent_at: Date; deadline_at: Date }>(
      `WITH issued AS (SELECT clock_timestamp() AS sent_at)
       INSERT INTO legacy_role_notices(tenant_id, notice_sent_at, deadline_at, issued_by)
       SELECT $1, sent_at, sent_at + INTERVAL '1440 hours', $2 FROM issued
       RETURNING notice_sent_at, deadline_at`, [tenantId, actor.userId],
    )).rows[0];
    if (!notice) throw new ServiceError(500, 'NOTICE_ISSUE_FAILED', 'Pemberitahuan tidak dapat diterbitkan.');
    return { created: true, ...notice };
  });
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
  const row = (await pool.query<{ email: string; role: Role; expires_at: Date; workspace: string; inviter: string | null; phone: string | null }>(
    `SELECT i.email, i.role, i.expires_at, i.phone, t.name AS workspace, u.name AS inviter
     FROM invitations i JOIN tenants t ON t.id = i.tenant_id LEFT JOIN users u ON u.id = i.invited_by
     WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()`,
    [sha256(token)],
  )).rows[0];
  if (!row) throw INVALID();
  const otpChannel = row.phone ? 'whatsapp' as const : 'email' as const;
  return {
    workspace: row.workspace, role: row.role, invited_by: row.inviter, email_hint: maskEmail(row.email), expires_at: row.expires_at,
    requires_otp: true, otp_channel: otpChannel,
    otp_available: otpChannel === 'whatsapp' || emailAvailable(),
    phone_hint: row.phone ? `****${row.phone.slice(-4)}` : null,
  };
}

const OTP_INVALID = () => new ServiceError(401, 'OTP_INVALID', 'Kode salah, kedaluwarsa, atau sudah dipakai. Minta kode baru.');

/** Sends a fresh OTP to the invited address (email) or WhatsApp number (CS invitations with phone). */
export async function requestInvitationOtp(token: string, ip?: string): Promise<{ sent: true; expires_in: number; resend_after: number }> {
  await reserveIpRequest(ip);
  const outcome = await transaction(async (client: PoolClient) => {
    const invite = (await client.query<{ id: string; tenant_id: string; email: string; workspace: string; phone: string | null }>(
      `SELECT i.id, i.tenant_id, i.email, i.phone, t.name AS workspace FROM invitations i JOIN tenants t ON t.id = i.tenant_id
       WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now() FOR UPDATE OF i`, [sha256(token)],
    )).rows[0];
    if (!invite) throw INVALID();
    const recent = (await client.query<{ last: number | null }>(
      'SELECT extract(epoch FROM now() - max(created_at))::float AS last FROM invitation_otps WHERE invitation_id = $1', [invite.id])).rows[0]!;
    if (recent.last !== null && recent.last < OTP_RESEND_SECONDS) {
      throw new ServiceError(429, 'OTP_COOLDOWN', `Tunggu ${Math.ceil(OTP_RESEND_SECONDS - recent.last)} detik sebelum meminta kode lagi.`, Math.ceil(OTP_RESEND_SECONDS - recent.last));
    }
    if (invite.phone) {
      await reserveWhatsappOtpSend(invite.phone);
    } else {
      requireEmail();
      await reserveOtpSend({ email: invite.email, invitationId: invite.id, tenantId: invite.tenant_id });
    }
    await client.query('UPDATE invitation_otps SET consumed_at = now() WHERE invitation_id = $1 AND consumed_at IS NULL', [invite.id]);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const row = (await client.query<{ id: string }>(
      `INSERT INTO invitation_otps (invitation_id, code_hash, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3)) RETURNING id`,
      [invite.id, otpHash(invite.id, code), OTP_MINUTES])).rows[0]!;
    return { otpId: row.id, email: invite.email, phone: invite.phone, workspace: invite.workspace, code, tenantId: invite.tenant_id };
  });
  if (outcome.phone) {
    await sendInvitationWhatsAppOtp(outcome);
  } else {
    try {
      await sendInvitationOtp({ to: outcome.email, code: outcome.code, workspace: outcome.workspace, validMinutes: OTP_MINUTES });
    } catch (error) {
      await pool.query('UPDATE invitation_otps SET consumed_at = now() WHERE id = $1', [outcome.otpId]);
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(502, 'EMAIL_SEND_FAILED', 'Kode verifikasi gagal dikirim. Coba lagi nanti.');
    }
  }
  return { sent: true, expires_in: OTP_MINUTES * 60, resend_after: OTP_RESEND_SECONDS };
}

async function sendInvitationWhatsAppOtp(outcome: { otpId: string; phone: string | null; code: string; workspace: string; tenantId: string }): Promise<void> {
  const sender = (await pool.query<{ device_key: string | null; tenant_id: string }>(
    `SELECT s.device_key, s.tenant_id FROM system_whatsapp_otp_sender s
     JOIN tenants t ON t.id=s.tenant_id AND t.is_system=true WHERE s.singleton=true`,
  )).rows[0];
  if (!sender?.device_key) {
    await pool.query('UPDATE invitation_otps SET consumed_at = now() WHERE id = $1', [outcome.otpId]);
    throw new ServiceError(503, 'WHATSAPP_OTP_NOT_CONFIGURED', 'Verifikasi WhatsApp belum dikonfigurasi. Hubungi operator.');
  }
  const device = (await pool.query<{ status: string }>(
    `SELECT status FROM devices WHERE device_key=$1 AND tenant_id=$2`, [sender.device_key, sender.tenant_id],
  )).rows[0];
  if (!device || device.status !== 'online') {
    await pool.query('UPDATE invitation_otps SET consumed_at = now() WHERE id = $1', [outcome.otpId]);
    throw new ServiceError(503, 'WHATSAPP_OTP_SENDER_OFFLINE', 'Pengirim OTP WhatsApp sedang tidak terhubung. Coba lagi nanti.');
  }
  try {
    const queued = await queueSystemOtp(sender.tenant_id, {
      device_key: sender.device_key, to: outcome.phone!,
      external_id: `invite_otp_${outcome.otpId}`,
      message: `${outcome.code} adalah kode verifikasi undangan ${outcome.workspace} di KONEVA. Berlaku ${OTP_MINUTES} menit. Jangan bagikan kode ini.`,
    });
    if (queued.status !== 'queued') throw new Error('queue failed');
  } catch (error) {
    await pool.query('UPDATE invitation_otps SET consumed_at = now() WHERE id = $1', [outcome.otpId]);
    logger.error('WhatsApp invitation OTP failed to queue', { otpId: outcome.otpId, error: error instanceof Error ? error.message : String(error) });
    throw new ServiceError(503, 'WHATSAPP_OTP_SEND_FAILED', 'Kode verifikasi WhatsApp gagal dikirim. Coba lagi nanti.');
  }
}

/**
 * Step 1 of accepting: count one attempt against the newest live OTP and compare the code. The attempt is committed on its own
 * (a wrong guess is never rolled back, and its conditions are re-checked after any row lock, so parallel guesses cannot exceed the
 * limit). On a match this only returns the OTP id: the code is CONSUMED later, inside the acceptance transaction, so consuming it,
 * creating the membership/account and verifying the email happen together or not at all.
 */
async function spendInvitationOtpAttempt(invitationId: string, code: string): Promise<string> {
  const row = (await pool.query<{ id: string; code_hash: string }>(
    `UPDATE invitation_otps o SET attempts = o.attempts + 1
     WHERE o.id = (SELECT id FROM invitation_otps WHERE invitation_id = $1 AND consumed_at IS NULL AND expires_at > now() AND attempts < $2
                   ORDER BY created_at DESC LIMIT 1)
       AND o.consumed_at IS NULL AND o.expires_at > now() AND o.attempts < $2
     RETURNING o.id, o.code_hash`, [invitationId, OTP_MAX_ATTEMPTS])).rows[0];
  const expected = Buffer.from(row?.code_hash ?? '0'.repeat(64)), given = Buffer.from(otpHash(invitationId, code));
  if (!row || expected.length !== given.length || !timingSafeEqual(expected, given)) throw OTP_INVALID();
  return row.id;
}

export interface AcceptInput {
  otp: string;
  session?: { userId: string; email: string } | undefined;
  newUser?: { name: string; password: string } | undefined;
  meta: { ip?: string | undefined; userAgent?: string | undefined };
}
export type AcceptResult =
  | { joined: { id: string; name: string; role: Role }; session?: SessionResult };

export async function acceptInvitation(token: string, input: AcceptInput): Promise<AcceptResult & { tenantId: string; userId: string }> {
  const passwordHash = input.newUser ? await hashPassword(input.newUser.password) : undefined;
  const pending = (await pool.query<{ id: string; email: string }>(
    `SELECT id, email FROM invitations WHERE token_hash = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`, [sha256(token)],
  )).rows[0];
  if (!pending) throw INVALID();
  // The wrong-address check comes first so a signed-in stranger cannot burn the real recipient's code attempts.
  if (input.session && input.session.email.toLowerCase() !== pending.email.toLowerCase()) {
    throw new ServiceError(403, 'EMAIL_MISMATCH', 'This invitation was sent to a different email address');
  }
  const otpId = await spendInvitationOtpAttempt(pending.id, input.otp);
  return transaction(async (client: PoolClient) => {
    const invite = (await client.query<{ id: string; tenant_id: string; email: string; role: Role; workspace: string; device_ids: string[] }>(
      `SELECT i.id, i.tenant_id, i.email, i.role, i.device_ids, t.name AS workspace
       FROM invitations i JOIN tenants t ON t.id = i.tenant_id
       WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now() FOR UPDATE OF i`,
      [sha256(token)],
    )).rows[0];
    if (!invite) throw INVALID();
    if (invite.id !== pending.id) throw INVALID();
    // Consumed here, in the same transaction as the membership, the account and email_verified_at. Two parallel accepts with the
    // same code cannot both pass: the loser waits on this row, re-checks consumed_at, and gets OTP_INVALID.
    const consumed = await client.query('UPDATE invitation_otps SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL AND expires_at > now() RETURNING id', [otpId]);
    if (!consumed.rowCount) throw OTP_INVALID();

    let userId: string;
    let created: { name: string } | undefined;
    if (input.session) {
      if (input.session.email.toLowerCase() !== invite.email.toLowerCase()) {
        throw new ServiceError(403, 'EMAIL_MISMATCH', 'This invitation was sent to a different email address');
      }
      userId = input.session.userId;
      await client.query('UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1', [userId]);
    } else {
      const existing = await client.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [invite.email]);
      if (existing.rows.length > 0) {
        throw new ServiceError(409, 'ACCOUNT_EXISTS', 'An account with this email already exists. Sign in, then accept the invitation.');
      }
      if (!input.newUser || !passwordHash) throw new ServiceError(400, 'MISSING_ACCOUNT_DETAILS', 'Name, password and acceptance of the terms are required');
      userId = (await client.query<{ id: string }>(
        `INSERT INTO users (email, name, password_hash, terms_accepted_at, terms_version, last_login_at, email_verified_at) VALUES ($1, $2, $3, now(), $4, now(), now()) RETURNING id`,
        [invite.email, input.newUser.name, passwordHash, TERMS_VERSION],
      )).rows[0]!.id;
      created = { name: input.newUser.name };
    }

    try {
      await client.query(`INSERT INTO memberships (user_id, tenant_id, role, device_ids) VALUES ($1, $2, $3, $4)`, [userId, invite.tenant_id, invite.role, invite.role === 'cs' ? invite.device_ids : []]);
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
  if (target.role === 'owner') throw new ServiceError(403, 'ROLE_NOT_GRANTABLE', 'Kepemilikan workspace tidak diubah lewat peran anggota.');
  if (!canManageMember(actor.role, target.role) || !canGrant(actor.role, newRole)) {
    throw new ServiceError(403, 'ROLE_NOT_GRANTABLE', 'Hanya Owner yang bisa mengubah peran menjadi Developer atau Customer Service.');
  }
  if (newRole === 'cs' && target.role !== 'cs') await assertMaxOneCs(tenantId);
  await pool.query('UPDATE memberships SET device_ids = CASE WHEN role=$3 THEN device_ids ELSE ARRAY[]::uuid[] END, role = $3 WHERE tenant_id = $1 AND user_id = $2', [tenantId, targetUserId, newRole]);
}

export async function removeMember(tenantId: string, actor: { userId: string; role: Role }, targetUserId: string): Promise<void> {
  if (actor.userId === targetUserId) throw new ServiceError(400, 'CANNOT_REMOVE_SELF', 'You cannot remove yourself');
  const target = (await pool.query<{ role: Role }>('SELECT role FROM memberships WHERE tenant_id = $1 AND user_id = $2', [tenantId, targetUserId])).rows[0];
  if (!target) throw new ServiceError(404, 'MEMBER_NOT_FOUND', 'Member not found');
  if (!canManageMember(actor.role, target.role)) throw new ServiceError(403, 'ROLE_NOT_GRANTABLE', 'Your role cannot remove this member');
  await pool.query('DELETE FROM memberships WHERE tenant_id = $1 AND user_id = $2', [tenantId, targetUserId]);
  // Their sessions stay valid for other workspaces, but this workspace no longer resolves for them.
}

/** Resolve workspace-owned devices; a deleted/recreated key never inherits grants. */
export async function resolveDeviceGrants(tenantId: string, keys: string[]): Promise<string[]> {
  const unique = [...new Set(keys)];
  if (!unique.length) return [];
  const result = await pool.query<{ id: string }>(
    "SELECT id FROM devices WHERE tenant_id=$1 AND device_key=ANY($2::text[]) AND status<>'deleted'", [tenantId, unique]);
  if (result.rows.length !== unique.length) throw new ServiceError(400, 'INVALID_DEVICE_GRANT', 'Pilih device aktif milik workspace ini.');
  return result.rows.map((row) => row.id);
}

export async function setMemberDevices(tenantId: string, actor: { userId: string; role: Role }, userId: string, keys: string[]): Promise<void> {
  if (actor.role !== 'owner') throw new ServiceError(403, 'FORBIDDEN', 'Hanya Owner yang bisa mengatur akses device CS.');
  const ids = await resolveDeviceGrants(tenantId, keys);
  const result = await pool.query("UPDATE memberships SET device_ids=$3 WHERE tenant_id=$1 AND user_id=$2 AND role='cs' RETURNING user_id", [tenantId, userId, ids]);
  if (!result.rowCount) throw new ServiceError(404, 'CS_NOT_FOUND', 'Anggota CS tidak ditemukan.');
}
