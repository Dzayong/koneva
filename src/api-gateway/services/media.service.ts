import { unlink } from 'node:fs/promises';
import config from '../../shared/config';
import pool from '../../shared/database/connection';

/** Delete expired database references and their private files in small batches. */
export async function purgeExpiredMedia(batchSize = 100): Promise<number> {
  const candidates = (await pool.query<{ id: string }>(
    `SELECT id FROM media_objects WHERE expires_at IS NOT NULL AND expires_at <= now()
     ORDER BY expires_at LIMIT $1`, [batchSize],
  )).rows;
  let removed = 0;
  for (const { id } of candidates) {
    const filePath = `${config.mediaStoragePath.replace(/\/$/, '')}/${id}`;
    try {
      await unlink(filePath).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
      const result = await pool.query('DELETE FROM media_objects WHERE id=$1 AND expires_at <= now()', [id]);
      removed += result.rowCount ?? 0;
    } catch (error) {
      // Do not discard metadata when the file could not be removed; the next sweep retries it.
      throw error;
    }
  }
  return removed;
}
