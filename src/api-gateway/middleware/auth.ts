import type { NextFunction, Request, Response } from 'express';
import config from '../../shared/config';
import pool from '../../shared/database/connection';
import { getRedisClient } from '../../shared/redis';
import type { TenantContext } from '../../shared/types/api';
import { safeEqual } from '../../shared/utils/secure-compare';
import { can, permissionFor } from '../../shared/permissions';
import { resolveSession } from '../services/account.service';
import { resolveApiKey } from '../services/apikey.service';

// Created on first use so importing this module (e.g. in tests) does not open a connection.
const redisClient = () => getRedisClient(config.redis.url);

function unauthorized(response: Response, message: string): void {
  response.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message } });
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
    request.tenant = session.tenant;
    request.actor = { kind: 'user', userId: session.user.id, email: session.user.email, role: session.role };
    next();
    return;
  }

  const apiKey = bearer ?? request.header('apikey');
  if (!apiKey) {
    unauthorized(response, 'Missing apikey or Authorization header');
    return;
  }

  if (apiKey.startsWith('wgk_')) {
    const resolved = await resolveApiKey(apiKey);
    if (!resolved) {
      unauthorized(response, 'Invalid, expired or revoked API key');
      return;
    }
    request.tenant = resolved.tenant;
    request.actor = { kind: 'api_key', role: 'viewer', scopes: resolved.scopes, keyId: resolved.keyId };
    next();
    return;
  }

  const cacheKey = `tenant:apikey:${apiKey}`;
  const cached = await redisClient().get(cacheKey);
  let tenant: TenantContext | undefined = cached
    ? (JSON.parse(cached) as TenantContext)
    : undefined;

  if (!tenant) {
    const result = await pool.query<TenantContext>(
      `SELECT id, name, email, api_key, webhook_url, webhook_secret,
              max_devices, quota_messages, used_messages, status
       FROM tenants WHERE api_key = $1 LIMIT 1`,
      [apiKey],
    );
    tenant = result.rows[0];
    if (tenant) await redisClient().set(cacheKey, JSON.stringify(tenant), 'EX', 300);
  }

  if (!tenant || tenant.status !== 'active') {
    unauthorized(response, 'Invalid or inactive API key');
    return;
  }

  request.tenant = tenant;
  // Legacy tenant keys keep the access they always had until scoped keys replace them.
  request.actor = { kind: 'api_key', role: 'admin' };
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

export function adminAuth(request: Request, response: Response, next: NextFunction): void {
  const suppliedKey = request.header('x-admin-key');
  if (!safeEqual(suppliedKey, config.adminApiKey)) {
    unauthorized(response, 'Invalid admin key');
    return;
  }
  request.isAdmin = true;
  next();
}
