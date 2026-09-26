import fs from 'node:fs';
import path from 'node:path';
import pool from '../src/shared/database/connection';
import logger from '../src/shared/utils/logger';

async function migrate(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMP DEFAULT NOW()
      )
    `);

    const { rows: executed } = await pool.query<{ name: string }>(
      'SELECT name FROM _migrations',
    );
    const executedNames = new Set(executed.map((row) => row.name));
    // ts-node lives in scripts/, compiled execution lives in dist/scripts/.
    const migrationsDirectory = fs.existsSync(path.join(__dirname, '..', 'migrations'))
      ? path.join(__dirname, '..', 'migrations')
      : path.join(__dirname, '..', '..', 'migrations');
    const files = fs
      .readdirSync(migrationsDirectory)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (executedNames.has(file)) {
        logger.info(`Skipping already executed: ${file}`);
        continue;
      }

      logger.info(`Executing migration: ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDirectory, file), 'utf8');
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        logger.info(`Completed: ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }

    logger.info('All migrations completed successfully');
  } catch (error) {
    logger.error('Migration failed', { error });
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void migrate();
