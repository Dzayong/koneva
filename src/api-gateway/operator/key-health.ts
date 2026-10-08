// MFA has been removed from Operator login. The key guard is no longer needed.
// This module is retained as a stub to avoid breaking any remaining imports.
import type { RequestHandler } from 'express';
import type { Pool } from 'pg';
import type { OperatorConfig } from './config';

export function createKeyGuard(_db: Pool, _config: OperatorConfig): RequestHandler {
  return (_request, _response, next) => { next(); };
}
