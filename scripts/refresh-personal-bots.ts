import { execFileSync } from 'node:child_process';
import { DockerBotManager } from '../src/device-manager/docker';
import { loadDeviceManagerConfig } from '../src/device-manager';
import pool from '../src/shared/database/connection';

async function main() {
  const config = loadDeviceManagerConfig();
  const manager = new DockerBotManager(config);
  const ids = execFileSync('docker', ['ps', '-q', '--filter', `label=wa.gateway.network=${config.dockerNetwork}`], { encoding: 'utf8' }).trim().split(/\s+/).filter(Boolean);
  for (const id of ids) {
    const key = execFileSync('docker', ['inspect', '--format', '{{index .Config.Labels "wa.gateway.device"}}', id], { encoding: 'utf8' }).trim();
    const device = await pool.query<{tenant_id: string}>(
      'SELECT tenant_id FROM devices WHERE device_key=$1', [key],
    );
    if (!device.rows[0]) throw new Error(`No device record for ${key}; refusing to recreate`);
    execFileSync('docker', ['stop', '--time', '30', id]);
    // Remove only the replaceable container, never its session directory.
    execFileSync('docker', ['rm', id]);
    await manager.createBot({ deviceKey: key, tenantId: device.rows[0].tenant_id });
    console.log(`Updated bot ${key}`);
  }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
