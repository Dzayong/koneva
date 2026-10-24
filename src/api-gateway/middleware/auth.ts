import type { NextFunction, Request, Response } from 'express';
import config from '../../shared/config';
import pool from '../../shared/database/connection';
import { safeEqual } from '../../shared/utils/secure-compare';
import { can, isLegacyRole, permissionFor } from '../../shared/permissions';
import { resolveSession } from '../services/account.service';
import { resolveApiKey } from '../services/apikey.service';

function unauthorized(response: Response, message: string): void {
  response.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message } });
}

async function hasExpiredUnresolvedLegacyRole(tenantId: string): Promise<boolean> {
  const transition = await pool.query<{ suspended: boolean }>(
    `SELECT n.deadline_at <= clock_timestamp() AND EXISTS (
       SELECT 1 FROM memberships m
       WHERE m.tenant_id = n.tenant_id AND m.role IN ('admin', 'viewer')
     ) AS suspended
     FROM legacy_role_notices n WHERE n.tenant_id = $1`,
    [tenantId],
  );
  return transition.rows[0]?.suspended ?? false;
}

function legacyRoleTransitionExpired(response: Response): void {
  response.status(403).json({
    success: false,
    error: { code: 'LEGACY_ROLE_TRANSITION_EXPIRED', message: 'Akses workspace ini ditangguhkan sampai Owner menentukan peran Anda. Hubungi Owner workspace untuk dijadikan Developer bila sesuai atau dikeluarkan dari workspace.' },
  });
}

export async function tenantAuth(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const authorization = request.header('authorization');
  const bearer = authorization?.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : undefined;
  if (bearer !== undefined && !bearer.startsWith('wgs_') && !bearer.startsWith('wgk_')) {
    unauthorized(response, 'Unrecognised bearer token');
    return;
  }
  if (bearer?.startsWith('wgs_')) {
    const session = await resolveSession(bearer, request.header('x-workspace') ?? undefined);
    if (!session) {
      unauthorized(response, 'Invalid or expired session');
      return;
    }
    if (isLegacyRole(session.role)) {
      if (await hasExpiredUnresolvedLegacyRole(session.tenant.id)) {
        legacyRoleTransitionExpired(response);
        return;
      }
    }
    request.tenant = session.tenant;
    request.actor = { kind: 'user', userId: session.user.id, email: session.user.email, role: session.role };
    next();
    return;
  }

  // The legacy static tenant key (and its Redis-cached lookup) was removed entirely 2026-10-02 (owner
  // decision: no fallback, no grace period). Only a scoped wgk_ key or a user session authenticate here.
  const apiKey = bearer ?? request.header('apikey');
  if (!apiKey?.startsWith('wgk_')) {
    unauthorized(response, 'Missing or invalid apikey');
    return;
  }
  const resolved = await resolveApiKey(apiKey);
  if (!resolved) {
    unauthorized(response, 'Invalid, expired or revoked API key');
    return;
  }
  if (await hasExpiredUnresolvedLegacyRole(resolved.tenant.id)) {
    legacyRoleTransitionExpired(response);
    return;
  }
  request.tenant = resolved.tenant;
  request.actor = { kind: 'api_key', role: 'viewer', scopes: resolved.scopes, keyId: resolved.keyId, deviceKey: resolved.deviceKey };
  next();
}

/** Deny by default: a route must have a permission rule and the caller's role must include it. */
export function authorize(request: Request, response: Response, next: NextFunction): void {
  const permission = permissionFor(request.method, request.path);
  const actor = request.actor;
  const allowed = actor
    ? (actor.kind === 'api_key' && actor.scopes ? actor.scopes.includes(permission as never) : can(actor.role, permission as never))
    : false;
  if (!permission || !allowed) {
    response.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: permission ? `Your role cannot perform this action (${permission})` : 'This route is not available' },
    });
    return;
  }
  next();
}

/** A device-bound API key may only read or operate on the device it was issued for. */
export async function enforceDeviceKeyScope(request: Request, response: Response, next: NextFunction): Promise<void> {
  const actor = request.actor;
  if (actor?.kind !== 'api_key' || !actor.deviceKey) { next(); return; }
  const path = request.path.replace(/\/+$/, '') || '/';
  let target: string | undefined;
  // Device routes are scoped by their path segment (the public route aliases use :key or :deviceKey).
  if (/^\/devices\/[^/]+(?:\/.*)?$/.test(path)) {
    target = typeof request.params['deviceKey'] === 'string' ? request.params['deviceKey']
      : typeof request.params['key'] === 'string' ? request.params['key'] : (path.split('/')[2] ?? '');
  } else if ((request.method === 'POST' && ['/message/send', '/broadcast'].includes(path))) {
    target = typeof request.body?.device_key === 'string' ? request.body.device_key : undefined;
  } else if (request.method === 'POST' && ['/inbox/media', '/media/upload'].includes(path)) {
    target = typeof request.query['device_key'] === 'string' ? request.query['device_key'] : undefined;
  } else if (request.method === 'GET' && ['/messages', '/auto-reply-rules'].includes(path)) {
    target = typeof request.query['device_key'] === 'string' ? request.query['device_key'] : undefined;
  } else if (/^\/messages\/[^/]+(?:\/retry)?$/.test(path)) {
    const messageId = path.split('/')[2];
    const result = await pool.query<{ device_key: string }>(
      'SELECT device_key FROM messages WHERE id=$1 AND tenant_id=$2', [messageId, request.tenant!.id],
    );
    target = result.rows[0]?.device_key;
  } else if (request.method === 'GET' && /^\/(?:inbox\/)?media\/[^/]+$/.test(path)) {
    const mediaId = path.split('/').at(-1);
    const result = await pool.query<{ device_key: string }>(
      'SELECT d.device_key FROM media_objects m JOIN devices d ON d.id=m.device_id WHERE m.id=$1 AND m.tenant_id=$2', [mediaId, request.tenant!.id],
    );
    target = result.rows[0]?.device_key;
  } else if (/^\/auto-reply-rules\/[^/]+$/.test(path)) {
    const ruleId = path.split('/')[2];
    const result = await pool.query<{ device_key: string }>(
      'SELECT device_key FROM auto_reply_rules WHERE id=$1 AND tenant_id=$2', [ruleId, request.tenant!.id],
    );
    target = result.rows[0]?.device_key;
    // A rule cannot be moved onto another device by a bound key.
    if (typeof request.body?.device_key === 'string' && request.body.device_key !== actor.deviceKey) target = undefined;
  } else if (request.method === 'POST' && path === '/auto-reply-rules') {
    target = typeof request.body?.device_key === 'string' ? request.body.device_key : undefined;
  }
  if (target !== actor.deviceKey) {
    response.status(403).json({ success: false, error: { code: 'API_KEY_DEVICE_SCOPE', message: 'This API key is restricted to its assigned device.' } });
    return;
  }
  next();
}

export function adminAuth(request: Request, response: Response, next: NextFunction): void {
  const suppliedKey = request.header('x-admin-key');
  if (!safeEqual(suppliedKey, config.adminApiKey)) {
    unauthorized(response, 'Invalid admin key');
    return;
  }
  request.isAdmin = true;
  next();
}
