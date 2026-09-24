import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canSendMessage,
  getDailyCapByHealthScore,
  getWarmupStage,
  isWithinSendingWindow,
  shouldRest,
  type QueryFn,
} from './anti-ban';

test('warm-up stages match the spec tiers', () => {
  assert.equal(getWarmupStage(1).maxMessagesPerDay, 5);
  assert.equal(getWarmupStage(2).maxMessagesPerDay, 5);
  assert.equal(getWarmupStage(1).proactiveAllowed, false);
  assert.equal(getWarmupStage(3).maxMessagesPerDay, 10);
  assert.equal(getWarmupStage(3).mediaAllowed, false);
  assert.equal(getWarmupStage(5).maxMessagesPerDay, 20);
  assert.equal(getWarmupStage(5).mediaAllowed, true);
  assert.equal(getWarmupStage(8).maxMessagesPerDay, 50);
  assert.equal(getWarmupStage(30).maxMessagesPerDay, 50);
});

test('daily cap follows health score tiers', () => {
  assert.equal(getDailyCapByHealthScore(95), 100);
  assert.equal(getDailyCapByHealthScore(90), 100);
  assert.equal(getDailyCapByHealthScore(80), 50);
  assert.equal(getDailyCapByHealthScore(60), 20);
  assert.equal(getDailyCapByHealthScore(35), 5);
  assert.equal(getDailyCapByHealthScore(10), null);
});

test('sending window rejects outside 8am-10pm WIB', () => {
  const noonUtc = new Date('2026-09-24T05:00:00Z'); // 12:00 WIB
  const midnightUtc = new Date('2026-09-24T18:00:00Z'); // 01:00 WIB next day
  assert.equal(isWithinSendingWindow(noonUtc), true);
  assert.equal(isWithinSendingWindow(midnightUtc), false);
});

test('friday lunch block is opt-in', () => {
  const fridayLunchUtc = new Date('2026-09-25T05:30:00Z'); // Friday 12:30 WIB
  assert.equal(isWithinSendingWindow(fridayLunchUtc), true);
  assert.equal(isWithinSendingWindow(fridayLunchUtc, { blockFridayLunch: true }), false);
});

test('rest kicks in every 50 messages', () => {
  assert.equal(shouldRest(0), false);
  assert.equal(shouldRest(49), false);
  assert.equal(shouldRest(50), true);
  assert.equal(shouldRest(100), true);
});

interface FakeDeviceRow {
  id: string;
  tenant_id: string;
  device_key: string;
  status: string;
  health_score: number;
  created_at: Date;
  warmup_started_at: Date | null;
  warmup_completed_at: Date | null;
  paused_until: Date | null;
}

function makeFakeQueryFn(device: FakeDeviceRow, messagesSentToday: number): QueryFn {
  return async (text: string) => {
    if (text.includes('FROM devices WHERE device_key')) {
      return { rows: [device] as unknown as Record<string, unknown>[] };
    }
    if (text.includes('COUNT(*) AS total_sent')) {
      return {
        rows: [
          { total_sent: '0', delivered: '0', replied: '0', blocked: '0', reported: '0' },
        ] as unknown as Record<string, unknown>[],
      };
    }
    if (text.includes('SELECT COUNT(*) AS count FROM messages')) {
      return { rows: [{ count: String(messagesSentToday) }] as unknown as Record<string, unknown>[] };
    }
    return { rows: [] };
  };
}

test('canSendMessage denies when device is not found', async () => {
  const queryFn: QueryFn = async () => ({ rows: [] });
  const decision = await canSendMessage('unknown-device', { queryFn });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'device_not_found');
});

test('canSendMessage denies when device is currently paused', async () => {
  const device: FakeDeviceRow = {
    id: 'device-1',
    tenant_id: 'tenant-1',
    device_key: 'WAPI-TEST01',
    status: 'paused',
    health_score: 10,
    created_at: new Date(Date.now() - 40 * 86_400_000),
    warmup_started_at: null,
    warmup_completed_at: null,
    paused_until: new Date(Date.now() + 3_600_000),
  };
  const decision = await canSendMessage('WAPI-TEST01', {
    queryFn: makeFakeQueryFn(device, 0),
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'device_paused');
});

test('canSendMessage denies a device paused via the admin API even without pausedUntil set', async () => {
  // POST /api/v1/devices/:key/pause (api-gateway) only sets devices.status —
  // it never touches paused_until, which only this module's own auto-pause
  // sets. Both mechanisms must block sending.
  const device: FakeDeviceRow = {
    id: 'device-admin-paused',
    tenant_id: 'tenant-1',
    device_key: 'WAPI-ADMIN-PAUSED',
    status: 'paused',
    health_score: 80,
    created_at: new Date(Date.now() - 40 * 86_400_000),
    warmup_started_at: null,
    warmup_completed_at: null,
    paused_until: null,
  };
  const decision = await canSendMessage('WAPI-ADMIN-PAUSED', {
    queryFn: makeFakeQueryFn(device, 0),
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'device_paused');
});

test('canSendMessage denies a banned device', async () => {
  const device: FakeDeviceRow = {
    id: 'device-banned',
    tenant_id: 'tenant-1',
    device_key: 'WAPI-BANNED',
    status: 'banned',
    health_score: 80,
    created_at: new Date(Date.now() - 40 * 86_400_000),
    warmup_started_at: null,
    warmup_completed_at: null,
    paused_until: null,
  };
  const decision = await canSendMessage('WAPI-BANNED', {
    queryFn: makeFakeQueryFn(device, 0),
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'device_paused');
});

test('canSendMessage allows a brand-new device within warm-up cap', async () => {
  const device: FakeDeviceRow = {
    id: 'device-2',
    tenant_id: 'tenant-1',
    device_key: 'WAPI-TEST02',
    status: 'online',
    health_score: 50,
    created_at: new Date('2026-09-24T04:00:00Z'),
    warmup_started_at: null,
    warmup_completed_at: null,
    paused_until: null,
  };
  const decision = await canSendMessage('WAPI-TEST02', {
    queryFn: makeFakeQueryFn(device, 0),
    now: new Date('2026-09-24T05:00:00Z'), // within sending window
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.dailyCap, 5);
  assert.equal(decision.warmupDay, 1);
});

test('canSendMessage denies once the warm-up daily cap is reached', async () => {
  const device: FakeDeviceRow = {
    id: 'device-3',
    tenant_id: 'tenant-1',
    device_key: 'WAPI-TEST03',
    status: 'online',
    health_score: 50,
    created_at: new Date('2026-09-24T04:00:00Z'),
    warmup_started_at: null,
    warmup_completed_at: null,
    paused_until: null,
  };
  const decision = await canSendMessage('WAPI-TEST03', {
    queryFn: makeFakeQueryFn(device, 5),
    now: new Date('2026-09-24T05:00:00Z'),
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'daily_cap_reached');
});

test('canSendMessage rejects spammy content even when quota allows it', async () => {
  const device: FakeDeviceRow = {
    id: 'device-4',
    tenant_id: 'tenant-1',
    device_key: 'WAPI-TEST04',
    status: 'online',
    health_score: 50,
    created_at: new Date('2026-09-24T04:00:00Z'),
    warmup_started_at: null,
    warmup_completed_at: null,
    paused_until: null,
  };
  const decision = await canSendMessage('WAPI-TEST04', {
    queryFn: makeFakeQueryFn(device, 0),
    now: new Date('2026-09-24T05:00:00Z'),
    content: 'PROMO GRATIS klik bit.ly/abc sekarang',
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'content_rejected');
  assert.ok(decision.contentReasons && decision.contentReasons.length > 0);
});
