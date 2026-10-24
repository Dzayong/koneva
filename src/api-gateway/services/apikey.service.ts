import { randomBytes } from 'node:crypto';
import pool from '../../shared/database/connection';
import { PERMISSIONS, ROLE_PERMISSIONS, type Permission, type Role } from '../../shared/permissions';
import type { TenantContext } from '../../shared/types/api';
import { sha256 } from './account.service';
import { ServiceError } from './service-error';

// A key can never manage keys, the team or billing; those stay with signed-in people.
export const KEY_SCOPES = PERMISSIONS.filter((p) => ![
  'keys:manage', 'team:manage', 'billing:manage', 'inbox:read', 'messages:reply',
].includes(p));
export const MAX_ACTIVE_KEYS = 20;
const TOUCH_AFTER_MS = 5 * 60_000;

export interface ApiKeyRecord {
  id: string; name: string; prefix: string; scopes: string[];
  device_key?: string | null;
  created_at: Date; last_used_at: Date | null; expires_at: Date | null; revoked_at: Date | null;
}

export function newApiKey(): { key: string; hash: string; prefix: string } {
  const key = `wgk_${randomBytes(32).toString('base64url')}`;
  return { key, hash: sha256(key), prefix: key.slice(0, 12) };
}

export function assertScopesAllowed(requested: readonly string[], role: Role): Permission[] {
  const allowed = new Set<string>(ROLE_PERMISSIONS[role]);
  const unique = [...new Set(requested)];
  const invalid = unique.filter((s) => !(KEY_SCOPES as readonly string[]).includes(s));
  if (invalid.length > 0) throw new ServiceError(400, 'INVALID_SCOPE', `Unknown or reserved scope: ${invalid.join(', ')}`);
  const escalated = unique.filter((s) => !allowed.has(s));
  if (escalated.length > 0) throw new ServiceError(403, 'SCOPE_EXCEEDS_ROLE', `Your role cannot grant: ${escalated.join(', ')}`);
  return unique as Permission[];
}

export async function createApiKey(
  tenantId: string, createdBy: string | null, role: Role,
  input: { name: string; scopes: string[]; expires_in_days?: number | undefined },
  deviceKey?: string,
): Promise<ApiKeyRecord & { key: string }> {
  const scopes = assertScopesAllowed(input.scopes, role);
  const active = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM api_keys WHERE tenant_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
    [tenantId],
  );
  if ((active.rows[0]?.n ?? 0) >= MAX_ACTIVE_KEYS) {
    throw new ServiceError(409, 'KEY_LIMIT', `A workspace can have at most ${MAX_ACTIVE_KEYS} active keys`);
  }
  const { key, hash, prefix } = newApiKey();
  const expiresAt = input.expires_in_days ? new Date(Date.now() + input.expires_in_days * 86_400_000) : null;
  const row = (await pool.query<ApiKeyRecord>(
    `INSERT INTO api_keys (tenant_id, name, prefix, key_hash, scopes, created_by, expires_at, device_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, name, prefix, scopes, device_key, created_at, last_used_at, expires_at, revoked_at`,
    [tenantId, input.name, prefix, hash, scopes, createdBy, expiresAt, deviceKey ?? null],
  )).rows[0]!;
  return { ...row, key };
}

export async function listApiKeys(tenantId: string, deviceKey?: string): Promise<ApiKeyRecord[]> {
  return (await pool.query<ApiKeyRecord>(
    `SELECT id, name, prefix, scopes, device_key, created_at, last_used_at, expires_at, revoked_at
     FROM api_keys WHERE tenant_id = $1 AND ($2::varchar IS NULL OR device_key=$2) ORDER BY created_at DESC`,
    [tenantId, deviceKey ?? null],
  )).rows;
}

export async function revokeApiKey(tenantId: string, id: string): Promise<void> {
  const result = await pool.query(
    `UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL RETURNING id`,
    [id, tenantId],
  );
  if (result.rows.length === 0) throw new ServiceError(404, 'KEY_NOT_FOUND', 'Key not found or already revoked');
}

/** New key with the same name and scopes; the old one keeps working for `overlapHours` so deploys can switch over. */
export async function rotateApiKey(
  tenantId: string, id: string, createdBy: string | null, role: Role, overlapHours: number,
): Promise<ApiKeyRecord & { key: string }> {
  const old = (await pool.query<ApiKeyRecord>(
    `SELECT id, name, prefix, scopes, device_key, created_at, last_used_at, expires_at, revoked_at
     FROM api_keys WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL`,
    [id, tenantId],
  )).rows[0];
  if (!old) throw new ServiceError(404, 'KEY_NOT_FOUND', 'Key not found or already revoked');
  const created = await createApiKey(tenantId, createdBy, role, { name: old.name, scopes: old.scopes }, old.device_key ?? undefined);
  await pool.query(
    `UPDATE api_keys SET expires_at = LEAST(COALESCE(expires_at, 'infinity'::timestamp), now() + make_interval(hours => $2::int)) WHERE id = $1`,
    [id, overlapHours],
  );
  return created;
}

export interface ResolvedKey { tenant: TenantContext; scopes: Permission[]; keyId: string; deviceKey: string | null }

export async function resolveApiKey(key: string): Promise<ResolvedKey | undefined> {
  const { rows } = await pool.query<TenantContext & { key_id: string; scopes: Permission[]; device_key: string | null; last_used_at: Date | null }>(
    `SELECT k.id AS key_id, k.scopes, k.device_key, k.last_used_at,
            t.id, t.name, t.email, t.webhook_url, t.webhook_secret,
            t.max_devices, t.quota_messages, t.used_messages, t.status
     FROM api_keys k JOIN tenants t ON t.id = k.tenant_id
     WHERE k.key_hash = $1 AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > now())`,
    [sha256(key)],
  );
  const row = rows[0];
  if (!row || row.status !== 'active') return undefined;
  if (!row.last_used_at || Date.now() - new Date(row.last_used_at).getTime() > TOUCH_AFTER_MS) {
    await pool.query('UPDATE api_keys SET last_used_at = now() WHERE id = $1', [row.key_id]);
  }
  const { key_id, scopes, device_key, last_used_at: _lastUsed, ...tenant } = row;
  return { tenant: tenant as TenantContext, scopes, keyId: key_id, deviceKey: device_key };
}
