import type { Request } from 'express';
import pool from '../../shared/database/connection';
import logger from '../../shared/utils/logger';

export interface AuditAction { action: string; targetType: string; targetId: string | null }

type Rule = readonly [method: string, pattern: RegExp, action: string, targetType: string, idGroup: number | null];

// Only actions that change something and matter to a team. Message sends are excluded on purpose:
// they are high volume and already have their own log.
const RULES: readonly Rule[] = [
  ['POST', /^\/devices$/, 'devices.create', 'device', null],
  ['POST', /^\/devices\/([^/]+)\/pause$/, 'devices.pause', 'device', 1],
  ['POST', /^\/devices\/([^/]+)\/resume$/, 'devices.resume', 'device', 1],
  ['POST', /^\/devices\/([^/]+)\/preset$/, 'devices.preset_apply', 'device', 1],
  ['PATCH', /^\/devices\/([^/]+)\/persona$/, 'devices.persona_update', 'device', 1],
  ['DELETE', /^\/devices\/([^/]+)$/, 'devices.delete', 'device', 1],
  ['PATCH', /^\/tenant$/, 'webhook.update', 'workspace', null],
  ['POST', /^\/keys$/, 'keys.create', 'api_key', null],
  ['POST', /^\/keys\/([^/]+)\/rotate$/, 'keys.rotate', 'api_key', 1],
  ['DELETE', /^\/keys\/([^/]+)$/, 'keys.revoke', 'api_key', 1],
  ['POST', /^\/team\/invitations$/, 'team.invite', 'invitation', null],
  ['DELETE', /^\/team\/invitations\/([^/]+)$/, 'team.invite_revoke', 'invitation', 1],
  ['PATCH', /^\/team\/members\/([^/]+)$/, 'team.role_change', 'user', 1],
  ['DELETE', /^\/team\/members\/([^/]+)$/, 'team.remove', 'user', 1],
  ['POST', /^\/billing\/orders$/, 'billing.order', 'invoice', null],
  ['POST', /^\/tenant\/webhook\/secret$/, 'webhook.secret_rotate', 'workspace', null],
  ['POST', /^\/billing\/student-request$/, 'billing.student_request', 'workspace', null],
  ['POST', /^\/broadcast$/, 'broadcast.create', 'broadcast', null],
  ['POST', /^\/auto-reply-rules$/, 'auto_reply.create', 'rule', null],
  ['PATCH', /^\/auto-reply-rules\/([^/]+)$/, 'auto_reply.update', 'rule', 1],
  ['POST', /^\/auto-reply-rules\/([^/]+)\/toggle$/, 'auto_reply.toggle', 'rule', 1],
  ['DELETE', /^\/auto-reply-rules\/([^/]+)$/, 'auto_reply.delete', 'rule', 1],
];

export function describeAction(method: string, path: string): AuditAction | undefined {
  const clean = path.length > 1 ? path.replace(/\/+$/, '') : path;
  for (const [m, pattern, action, targetType, idGroup] of RULES) {
    if (m !== method.toUpperCase()) continue;
    const match = pattern.exec(clean);
    if (match) return { action, targetType, targetId: idGroup ? (match[idGroup] ?? null) : null };
  }
  return undefined;
}

export interface AuditEntry {
  tenantId: string; actorType: 'user' | 'api_key' | 'system'; actorId?: string | undefined;
  actorLabel?: string | undefined; action: string; targetType?: string | undefined;
  targetId?: string | null | undefined; ip?: string | undefined;
}

/** Never throws: a failed audit write must not fail the action that was already done. */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_log (tenant_id, actor_type, actor_id, actor_label, action, target_type, target_id, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [entry.tenantId, entry.actorType, entry.actorId ?? null, entry.actorLabel ?? null, entry.action,
        entry.targetType ?? null, entry.targetId ?? null, entry.ip?.slice(0, 64) ?? null],
    );
  } catch (error) {
    logger.error('Failed to write audit log', { action: entry.action, error: error instanceof Error ? error.message : String(error) });
  }
}

export function auditFromRequest(request: Request, found: AuditAction, override?: { targetId?: string | undefined }): AuditEntry | undefined {
  const actor = request.actor;
  if (!request.tenant || !actor) return undefined;
  return {
    tenantId: request.tenant.id,
    actorType: actor.kind,
    actorId: actor.kind === 'user' ? actor.userId : (actor.keyId ?? 'legacy'),
    actorLabel: actor.kind === 'user' ? actor.email : (actor.keyId ? `key ${actor.keyId.slice(0, 8)}` : 'legacy tenant key'),
    action: found.action, targetType: found.targetType, targetId: override?.targetId ?? found.targetId, ip: request.ip,
  };
}

/** Id of the thing a create call made, read from a `{ data: { id | device_key } }` response. */
export function targetFromBody(body: unknown): string | undefined {
  const data = (body as { data?: { id?: unknown; device_key?: unknown } } | null)?.data;
  const value = data?.id ?? data?.device_key;
  return typeof value === 'string' ? value.slice(0, 80) : undefined;
}

export async function listAudit(tenantId: string, limit: number, before?: Date) {
  return (await pool.query(
    `SELECT id, actor_type, actor_id, actor_label, action, target_type, target_id, ip, created_at
     FROM audit_log WHERE tenant_id = $1 AND ($3::timestamp IS NULL OR created_at < $3)
     ORDER BY created_at DESC LIMIT $2`,
    [tenantId, limit, before ?? null],
  )).rows;
}
