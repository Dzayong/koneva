import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { Logger } from 'winston';
import { startBotConnection } from './connection';
import type { BotConfig, ConnectionState } from './types';

function testLogger(): Logger {
  const noop = () => testLogger();
  return { debug: noop, info: noop, warn: noop, error: noop } as unknown as Logger;
}

function testConfig(overrides: Partial<BotConfig> = {}): BotConfig {
  return {
    botId: 'WAPI-TESTMOCK01',
    nodeEnv: 'test',
    databaseUrl: 'postgres://invalid/unused',
    redisUrl: 'redis://invalid/unused',
    sessionPath: path.join(os.tmpdir(), `koneva-connection-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    healthPort: 0,
    maxReconnectAttempts: 3,
    reconnectDelaysMs: [1000],
    queueName: 'unused',
    apiKeys: [],
    ...overrides,
  };
}

test('WHATSAPP_TRANSPORT=mock never touches a real session or the network: no session directory is ever created', async () => {
  const before = process.env['WHATSAPP_TRANSPORT'];
  const beforeSandbox = process.env['KONEVA_SANDBOX'];
  process.env['WHATSAPP_TRANSPORT'] = 'mock';
  delete process.env['KONEVA_SANDBOX'];
  try {
    const config = testConfig();
    const states: ConnectionState[] = [];
    // loadSession() (the real, unmocked path) unconditionally calls fs.mkdirSync on sessionDir(sessionPath, botId)
    // before anything Baileys/network-related runs -- so its absence is concrete, checkable proof that mock mode
    // short-circuited before loadSession, not just an inference from the final reported status.
    await startBotConnection(config, testLogger(), { onStateChange: async (s) => { states.push(s); } });
    assert.equal(fs.existsSync(path.join(config.sessionPath, config.botId)), false, 'a real session directory must never be created in mock mode');
    assert.equal(states.length, 1);
    assert.equal(states[0]!.status, 'offline');
    assert.equal(states[0]!.lastDisconnectReason, 'sandbox_mock_transport');
    assert.equal(states[0]!.reconnectAttempt, 0);
  } finally {
    if (before === undefined) delete process.env['WHATSAPP_TRANSPORT']; else process.env['WHATSAPP_TRANSPORT'] = before;
    if (beforeSandbox === undefined) delete process.env['KONEVA_SANDBOX']; else process.env['KONEVA_SANDBOX'] = beforeSandbox;
  }
});

test('KONEVA_SANDBOX=1 forces mock even if WHATSAPP_TRANSPORT=real is also set (no accidental override)', async () => {
  const before = process.env['WHATSAPP_TRANSPORT'];
  const beforeSandbox = process.env['KONEVA_SANDBOX'];
  process.env['WHATSAPP_TRANSPORT'] = 'real';
  process.env['KONEVA_SANDBOX'] = '1';
  try {
    const config = testConfig();
    const states: ConnectionState[] = [];
    await startBotConnection(config, testLogger(), { onStateChange: async (s) => { states.push(s); } });
    assert.equal(fs.existsSync(path.join(config.sessionPath, config.botId)), false);
    assert.equal(states[0]!.status, 'offline');
    assert.equal(states[0]!.lastDisconnectReason, 'sandbox_mock_transport');
  } finally {
    if (before === undefined) delete process.env['WHATSAPP_TRANSPORT']; else process.env['WHATSAPP_TRANSPORT'] = before;
    if (beforeSandbox === undefined) delete process.env['KONEVA_SANDBOX']; else process.env['KONEVA_SANDBOX'] = beforeSandbox;
  }
});
