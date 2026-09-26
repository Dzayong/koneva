import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { DockerBotManager } from './docker';
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
