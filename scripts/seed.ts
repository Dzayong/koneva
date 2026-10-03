import pool from '../src/shared/database/connection';
import logger from '../src/shared/utils/logger';

async function seed(): Promise<void> {
  try {
    const tenantResult = await pool.query<{ id: string }>(`
      INSERT INTO tenants (name, email, max_devices, quota_messages)
      VALUES ('Test Tenant', 'test@example.com', 5, 10000)
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `);

    const tenantId = tenantResult.rows[0]?.id;
    if (!tenantId) {
      throw new Error('Unable to resolve the test tenant ID');
    }

    logger.info('Test tenant ready', { tenantId });
    await pool.query(
      `
        INSERT INTO devices (tenant_id, device_key, phone_number, label, status, container_port)
        VALUES
          ($1, 'WAPI-TEST01', '+6281234567890', 'Sales Jakarta', 'offline', 3001),
          ($1, 'WAPI-TEST02', '+6281234567891', 'Sales Surabaya', 'offline', 3002)
        ON CONFLICT (device_key) DO NOTHING
      `,
      [tenantId],
    );

    logger.info('Test devices ready');
    logger.info('Seed completed');
  } catch (error) {
    logger.error('Seed failed', { error });
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void seed();
