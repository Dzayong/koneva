import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { DockerBotManager, parseDockerResourceSnapshot } from './docker';
import type { DeviceManagerConfig } from './types';

const config: DeviceManagerConfig = {
  mode: 'docker',
  port: 8001,
  adminApiKey: 'admin-key',
  jwtSecret: 'jwt-secret',
  botImage: 'wa-bot:latest',
  databaseUrl: 'postgresql://user:p%40ss@localhost:5432/db',
  redisUrl: 'redis://localhost:6379',
  sessionHostPath: '/tmp/wa-gateway-test-sessions',
  dockerNetwork: 'docker_default',
  kubernetes: { namespace: 'wa-gateway', inCluster: false, sessionStorageSize: '1Gi' },
};

function fakeRunner(existingEnv: string[] | null) {
  const calls: string[][] = [];
  const runner = async (_file: string, args: readonly string[]) => {
    calls.push([...args]);
    if (args[0] === 'inspect') {
      if (!existingEnv) throw new Error('No such container');
      return { stdout: JSON.stringify(existingEnv), stderr: '' };
    }
    return { stdout: 'container-id\n', stderr: '' };
  };
  return { calls, runner };
}

test('new bot container receives JWT_SECRET and ADMIN_API_KEY', async () => {
  const { calls, runner } = fakeRunner(null);
  await new DockerBotManager(config, runner).createBot({ deviceKey: 'WAPI-TEST1', tenantId: 't' });
  const run = calls.find((args) => args[0] === 'run');
  assert.ok(run?.includes('JWT_SECRET=jwt-secret'));
  assert.ok(run?.includes('ADMIN_API_KEY=admin-key'));
  assert.ok(run?.includes('unless-stopped'));
  assert.ok(run?.includes('wa.gateway.network=docker_default'));
});

test('existing container without JWT_SECRET is recreated, not restarted', async () => {
  const { calls, runner } = fakeRunner(['BOT_ID=WAPI-TEST1']);
  await new DockerBotManager(config, runner).createBot({ deviceKey: 'WAPI-TEST1', tenantId: 't' });
  assert.ok(calls.some((args) => args[0] === 'rm'));
  assert.ok(calls.some((args) => args[0] === 'run'));
  assert.ok(!calls.some((args) => args[0] === 'start'));
});

test('existing container with JWT_SECRET is just started', async () => {
  const { calls, runner } = fakeRunner(['JWT_SECRET=x']);
  await new DockerBotManager(config, runner).createBot({ deviceKey: 'WAPI-TEST1', tenantId: 't' });
  assert.ok(calls.some((args) => args[0] === 'start'));
  assert.ok(!calls.some((args) => args[0] === 'run'));
});

test('reconnect restarts an existing container without deleting its session', async () => {
  const calls: string[][] = [];
  const runner = async (_file: string, args: readonly string[]) => {
    calls.push([...args]);
    return { stdout: 'wa-bot-wapi-test1\n', stderr: '' };
  };
  const result = await new DockerBotManager(config, runner).restartBot({ deviceKey: 'WAPI-TEST1', tenantId: 'tenant' });
  assert.equal(result.resourceName, 'wa-bot-wapi-test1');
  assert.deepEqual(calls, [['restart', 'wa-bot-wapi-test1']]);
});

test('localhost in DATABASE_URL (with credentials) and REDIS_URL is rewritten to the host', async () => {
  const { calls, runner } = fakeRunner(null);
  await new DockerBotManager(config, runner).createBot({ deviceKey: 'WAPI-TEST1', tenantId: 't' });
  const run = calls.find((args) => args[0] === 'run');
  assert.ok(run?.includes('DATABASE_URL=postgresql://user:p%40ss@host.docker.internal:5432/db'));
  assert.ok(run?.includes('REDIS_URL=redis://host.docker.internal:6379'));
});

test('bot runs as the session directory owner', async () => {
  if (!process.getuid || !process.getgid) return;
  const { calls, runner } = fakeRunner(null);
  await new DockerBotManager(config, runner).createBot({ deviceKey: 'WAPI-TEST1', tenantId: 't' });
  const run = calls.find((args) => args[0] === 'run')!;
  assert.equal(run[run.indexOf('--user') + 1], `${process.getuid()}:${process.getgid()}`);
});

test('deleteBot removes the container and its session directory', async () => {
  const dir = path.join(config.sessionHostPath, 'WAPI-DEL1');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'creds.json'), '{}');
  const { calls, runner } = fakeRunner(null);
  await new DockerBotManager(config, runner).deleteBot('WAPI-DEL1');
  assert.deepEqual(calls[0], ['rm', '-f', 'wa-bot-wapi-del1']);
  assert.equal(existsSync(dir), false);
});

test('bot container is started with hardening flags and resource limits', async () => {
  const { calls, runner } = fakeRunner(null);
  await new DockerBotManager(config, runner).createBot({ deviceKey: 'WAPI-TEST1', tenantId: 't' });
  const run = calls.find((args) => args[0] === 'run')!;
  const after = (flag: string) => run[run.indexOf(flag) + 1];
  assert.equal(after('--cap-drop'), 'ALL');
  assert.equal(after('--security-opt'), 'no-new-privileges');
  assert.ok(run.includes('--read-only'));
  assert.equal(after('--memory'), '512m');
  assert.equal(after('--pids-limit'), '256');
});

test('proxy URL is forwarded to the bot only when configured', async () => {
  const without = fakeRunner(null);
  await new DockerBotManager(config, without.runner).createBot({ deviceKey: 'WAPI-TEST1', tenantId: 't' });
  assert.ok(!without.calls.find((args) => args[0] === 'run')!.some((a) => a.startsWith('WA_PROXY_URL=')));

  const withProxy = fakeRunner(null);
  await new DockerBotManager({ ...config, botProxyUrl: 'socks5://u:p@10.0.0.1:1080' }, withProxy.runner)
    .createBot({ deviceKey: 'WAPI-TEST1', tenantId: 't' });
  assert.ok(withProxy.calls.find((args) => args[0] === 'run')!.includes('WA_PROXY_URL=socks5://u:p@10.0.0.1:1080'));
});

test('resource snapshot parses device and shared container CPU/RAM, ignoring unselected containers', () => {
  const selected = new Map<string, { kind: 'device' | 'shared'; service: string | null; deviceKey: string | null }>([
    ['wa-bot-wapi-a1', { kind: 'device', service: null, deviceKey: 'WAPI-A1' }],
    ['wa-personal-api-gateway-1', { kind: 'shared', service: 'api-gateway', deviceKey: null }],
  ]);
  const result = parseDockerResourceSnapshot([
    JSON.stringify({ Name: 'wa-bot-wapi-a1', CPUPerc: '12.50%', MemUsage: '128MiB / 512MiB' }),
    JSON.stringify({ Name: 'wa-personal-api-gateway-1', CPUPerc: '90.00%', MemUsage: '1GiB / 2GiB' }),
    JSON.stringify({ Name: 'unrelated-container', CPUPerc: '10.00%', MemUsage: '1MiB / 2GiB' }),
  ].join('\n'), selected, '2026-10-17T00:00:00.000Z');
  assert.deepEqual(result, {
    available: true,
    source: 'docker-stats',
    sampledAt: '2026-10-17T00:00:00.000Z',
    containers: [
      { name: 'wa-bot-wapi-a1', kind: 'device', service: null, deviceKey: 'WAPI-A1', cpuPercent: 12.5, memoryUsageBytes: 134_217_728, memoryLimitBytes: 536_870_912 },
      { name: 'wa-personal-api-gateway-1', kind: 'shared', service: 'api-gateway', deviceKey: null, cpuPercent: 90, memoryUsageBytes: 1_073_741_824, memoryLimitBytes: 2_147_483_648 },
    ],
  });
});

test('resource snapshot fails closed on malformed Docker stats instead of reporting partial zeros', () => {
  assert.throws(() => parseDockerResourceSnapshot(
    JSON.stringify({ Name: 'wa-bot-wapi-a1', CPUPerc: 'n/a', MemUsage: '128MiB / 512MiB' }),
    new Map([['wa-bot-wapi-a1', { kind: 'device' as const, service: null, deviceKey: 'WAPI-A1' }]]),
  ), /invalid format/);
});

test('resource snapshot includes managed device and shared Compose containers, excluding unrelated containers', async () => {
  const calls: string[][] = [];
  const runner = async (_file: string, args: readonly string[]) => {
    calls.push([...args]);
    if (args[0] === 'ps') return { stdout: [
      'wa-bot-wapi-a1|docker_default|WAPI-A1|<no value>|<no value>',
      'wa-personal-postgres-1|<no value>|<no value>|postgres|wa-personal',
      'wa-personal-redis-1|<no value>|<no value>|redis|wa-personal',
      'wa-personal-api-gateway-1|<no value>|<no value>|api-gateway|wa-personal',
      'wa-personal-device-manager-1|<no value>|<no value>|device-manager|wa-personal',
      'wa-personal-dashboard-1|<no value>|<no value>|dashboard|wa-personal',
      'unrelated-container|docker_default|<no value>|<no value>|<no value>',
      'other-compose-postgres-1|<no value>|<no value>|postgres|other-project',
    ].join('\n'), stderr: '' };
    if (args[0] === 'stats') return { stdout: args.slice(4).map((name) => JSON.stringify({
      Name: name, CPUPerc: '1.00%', MemUsage: '1MiB / 512MiB',
    })).join('\n'), stderr: '' };
    throw new Error('unexpected docker command');
  };
  const result = await new DockerBotManager(config, runner).getResourceSnapshot();
  assert.equal(result.available, true);
  assert.deepEqual(calls[0], [
    'ps', '--filter', 'network=docker_default', '--format',
    '{{.Names}}|{{.Label "wa.gateway.network"}}|{{.Label "wa.gateway.device"}}|{{.Label "com.docker.compose.service"}}|{{.Label "com.docker.compose.project"}}',
  ]);
  assert.equal(calls[1]?.[0], 'stats');
  assert.ok(calls[1]?.includes('--no-stream'));
  assert.deepEqual(calls[1]?.slice(4), [
    'wa-bot-wapi-a1', 'wa-personal-postgres-1', 'wa-personal-redis-1', 'wa-personal-api-gateway-1',
    'wa-personal-device-manager-1', 'wa-personal-dashboard-1',
  ]);
  if (!result.available) throw new Error('expected Docker metrics');
  assert.deepEqual(result.containers.map((row) => [row.name, row.kind, row.service, row.deviceKey]), [
    ['wa-bot-wapi-a1', 'device', null, 'WAPI-A1'],
    ['wa-personal-postgres-1', 'shared', 'postgres', null],
    ['wa-personal-redis-1', 'shared', 'redis', null],
    ['wa-personal-api-gateway-1', 'shared', 'api-gateway', null],
    ['wa-personal-device-manager-1', 'shared', 'device-manager', null],
    ['wa-personal-dashboard-1', 'shared', 'dashboard', null],
  ]);
});
