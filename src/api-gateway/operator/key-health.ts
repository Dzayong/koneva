import type { RequestHandler } from 'express';
import type { Pool } from 'pg';
import logger from '../../shared/utils/logger';
import type { OperatorConfig } from './config';
import { OperatorError } from './core';
import { decryptSecret } from './mfa';

/**
 * Fail closed when OPERATOR_MFA_ENC_KEY is syntactically valid but is NOT the key the stored secrets were sealed with
 * (wrong environment, rotation half-done, restored database without the matching key). Without this, every operator would
 * just see "wrong code" with no hint. Samples a few enrolled operators; the answer is cached briefly.
 * With no enrolled operator yet there is nothing to contradict the key, so the module stays available (first enrollment).
 */
export function createKeyGuard(db: Pool, config: OperatorConfig, now: () => number = Date.now): RequestHandler {
  let checkedAt = 0;
  let healthy = true;
  const ttl = () => (healthy ? 60_000 : 10_000);
  return async (_request, _response, next) => {
    if (config.mfaKey && now() - checkedAt > ttl()) {
      const rows = (await db.query<{ id: string; mfa_secret_enc: string }>(
        'SELECT id, mfa_secret_enc FROM operators WHERE mfa_secret_enc IS NOT NULL ORDER BY id LIMIT 5')).rows;
      healthy = rows.every((row) => { try { decryptSecret(config.mfaKey!, row.mfa_secret_enc, row.id); return true; } catch { return false; } });
      checkedAt = now();
      if (!healthy) logger.error('OPERATOR_MFA_ENC_KEY does not match stored MFA secrets; operator panel is closed until fixed (docs/OPERATOR_PANEL.md)');
    }
    if (!healthy) throw new OperatorError(503, 'OPERATOR_KEY_INVALID', 'Panel operator ditutup karena konfigurasi kunci tidak cocok. Hubungi administrator.');
    next();
  };
}
