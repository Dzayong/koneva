import type { Pool } from 'pg';

/** A session-level PostgreSQL lease held for the full lifetime of one bot process. */
export interface DeviceProcessLease {
  release(): Promise<void>;
}

/**
 * Prevent two bot processes from opening the same WhatsApp session concurrently.
 * The dedicated client must stay checked out: PostgreSQL advisory locks belong to
 * that connection and are released automatically if the process/connection dies.
 */
export async function acquireDeviceProcessLease(pool: Pool, deviceKey: string): Promise<DeviceProcessLease> {
  const client = await pool.connect();
  let acquired = false;
  try {
    const result = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
      [`koneva:bot-process:${deviceKey.trim().toUpperCase()}`],
    );
    acquired = result.rows[0]?.acquired === true;
    if (!acquired) {
      throw new Error(`Another bot process already owns device ${deviceKey}`);
    }
  } catch (error) {
    client.release();
    throw error;
  }

  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      try {
        await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [
          `koneva:bot-process:${deviceKey.trim().toUpperCase()}`,
        ]);
      } finally {
        client.release();
      }
    },
  };
}
