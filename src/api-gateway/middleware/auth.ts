import type { NextFunction, Request, Response } from 'express';
import config from '../../shared/config';
import pool from '../../shared/database/connection';
import { getRedisClient } from '../../shared/redis';
import type { TenantContext } from '../../shared/types/api';

const redis = getRedisClient(config.redis.url);

function unauthorized(response: Response, message: string): void {
  response.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message } });
}

export async function tenantAuth(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const apiKey = request.header('apikey');
  if (!apiKey) {
    unauthorized(response, 'Missing apikey header');
    return;
  }

  const cacheKey = `tenant:apikey:${apiKey}`;
  const cached = await redis.get(cacheKey);
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
    if (tenant) await redis.set(cacheKey, JSON.stringify(tenant), 'EX', 300);
  }

  if (!tenant || tenant.status !== 'active') {
    unauthorized(response, 'Invalid or inactive API key');
    return;
  }

  request.tenant = tenant;
  next();
}

export function adminAuth(request: Request, response: Response, next: NextFunction): void {
  const suppliedKey = request.header('x-admin-key');
  if (!suppliedKey || suppliedKey !== config.adminApiKey) {
    unauthorized(response, 'Invalid admin key');
    return;
  }
  request.isAdmin = true;
  next();
}
