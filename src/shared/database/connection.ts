import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import config from '../config';
import logger from '../utils/logger';

// Every timestamp column in this schema (devices, messages, tenants,
// webhook_logs, message_status_history) is `timestamp without time zone`.
// node-postgres reads AND writes those using the Node PROCESS's LOCAL
// timezone convention (not UTC) — e.g. a stored "16:59:18" wall clock
// (session TimeZone is UTC, verified via `SHOW timezone`) round-trips as
// 7 hours off in this deployment (host is WIB, UTC+7) the moment it's
// compared against a `new Date()`. Pinning the process's own idea of
// "local" to UTC is what actually makes that pairing correct — patching
// only the read side (a custom OID 1114 type parser) leaves outgoing
// query parameters still wrong, which is worse: it looks fixed but isn't.
// Verified: anti-ban.ts's per-minute/daily rate-limit windows silently
// under-counted messages sent moments earlier until this was set.
process.env['TZ'] = 'UTC';

const pool = new Pool({
  connectionString: config.database.url,
  max: Number(process.env['DB_POOL_MAX']) > 0 ? Number(process.env['DB_POOL_MAX']) : 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (error) => {
  logger.error('Unexpected database error', { error });
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  const start = Date.now();

  try {
    const result = await pool.query<T>(text, params);
    logger.debug('Query executed', {
      text,
      duration: Date.now() - start,
      rows: result.rowCount,
    });
    return result;
  } catch (error) {
    logger.error('Query error', { text, error });
    throw error;
  }
}

export async function transaction<T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export default pool;
