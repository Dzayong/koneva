import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canSendMessage,
  countMessagesSince,
  getDailyCapByHealthScore,
  getWarmupStage,
  isWithinSendingWindow,
  type QueryFn,
} from './anti-ban';

test('send budget counts persisted in-flight sends as reservations', async () => {
  let statement = '';
  const queryFn: QueryFn = async (sql) => { statement = sql; return { rows: [{ count: '2' }] } as never; };
  assert.equal(await countMessagesSince('device-1', new Date(), queryFn), 2);
  assert.match(statement, /status IN \('sending', 'sent', 'delivered', 'read'\)/);
  assert.match(statement, /status = 'failed' AND error_message = 'delivery_uncertain'/);
  assert.match(statement, /COALESCE\(sent_at, send_started_at, created_at\)/);
});

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

test('one-message warm-up approval bypasses only the warm-up gate, not caps or paused-device checks', async () => {
  const now = new Date('2026-09-24T05:00:00Z');
  const newDevice: FakeDeviceRow = {
    id: 'device-warmup-approval', tenant_id: 'tenant-1', device_key: 'WAPI-WARMUP-APPROVAL', status: 'online', health_score: 50,
    created_at: new Date(now.getTime() - 60 * 60_000), warmup_started_at: null, warmup_completed_at: null, paused_until: null,
  };
  const queryFn = makeFakeQueryFn(newDevice, 0);
  const input = { queryFn, isProactive: true, recipient: '6281234567890', content: 'Hai', now };
  const held = await canSendMessage(newDevice.device_key, input);
  assert.equal(held.reason, 'proactive_not_allowed_in_warmup');

  const approved = await canSendMessage(newDevice.device_key, { ...input, allowWarmupOverride: true });
  assert.equal(approved.allowed, true, `denied: ${approved.reason}`);

  const capped = await canSendMessage(newDevice.device_key, { ...input, allowWarmupOverride: true, queryFn: makeFakeQueryFn(newDevice, 5) });
  assert.equal(capped.reason, 'daily_cap_reached');

  const paused = { ...newDevice, status: 'paused' };
  const blocked = await canSendMessage(paused.device_key, { ...input, allowWarmupOverride: true, queryFn: makeFakeQueryFn(paused, 0) });
  assert.equal(blocked.reason, 'device_paused');
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
  assert.equal(decision.reason, 'device_banned');
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
  // Warm-up cap is 5; the per-day persona factor may only lower it (never above the cap).
  assert.ok(decision.dailyCap >= 4 && decision.dailyCap <= 5, `cap ${decision.dailyCap}`);
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

test('canSendMessage refuses proactive sends to a recipient who asked to stop, but still allows replies', async () => {
  const device: FakeDeviceRow = {
    id: 'device-optout',
    tenant_id: 'tenant-1',
    device_key: 'WAPI-OPTOUT',
    status: 'online',
    health_score: 50,
    created_at: new Date('2026-09-24T04:00:00Z'),
    warmup_started_at: null,
    warmup_completed_at: null,
    paused_until: null,
  };
  const base = makeFakeQueryFn(device, 0);
  const queryFn: QueryFn = async (text, params) =>
    text.includes('SELECT 1 FROM messages') && text.includes('content ~*')
      ? { rows: [{ '?column?': 1 }] }
      : base(text, params);
  const now = new Date('2026-09-24T05:00:00Z');

  const proactive = await canSendMessage('WAPI-OPTOUT', { queryFn, isProactive: true, recipient: '6281234567890', content: 'Promo baru', now });
  assert.equal(proactive.allowed, false);
  assert.equal(proactive.reason, 'recipient_opted_out');

  const reply = await canSendMessage('WAPI-OPTOUT', { queryFn, isProactive: false, recipient: '6281234567890', content: 'Baik, sudah kami catat', now });
  assert.notEqual(reply.reason, 'recipient_opted_out');
});

test('proactive sends rest after a burst and are re-queued at the end of the rest; replies are not held back', async () => {
  const device: FakeDeviceRow = {
    id: 'device-rest', tenant_id: 'tenant-1', device_key: 'WAPI-REST', status: 'online', health_score: 50,
    created_at: new Date('2026-09-24T04:00:00Z'), warmup_started_at: null, warmup_completed_at: null, paused_until: null,
  };
  const now = new Date('2026-09-24T05:00:00Z');
  const base = makeFakeQueryFn(device, 0);
  const queryFn: QueryFn = async (text, params) =>
    text.includes('LAG(at)')
      ? { rows: [{ burst_start: new Date(now.getTime() - 10 * 60_000), burst_count: 100, last_at: new Date(now.getTime() - 30_000) }] }
      : base(text, params);

  const proactive = await canSendMessage('WAPI-REST', { queryFn, isProactive: true, recipient: '6281234567890', content: 'Halo', now });
  assert.equal(proactive.allowed, false);
  assert.equal(proactive.reason, 'resting');
  assert.ok((proactive.retryAfterMs ?? 0) > 3 * 60_000, `retry ${proactive.retryAfterMs}`);

  const reply = await canSendMessage('WAPI-REST', { queryFn, isProactive: false, recipient: '6281234567890', content: 'Baik Kak', now });
  assert.notEqual(reply.reason, 'resting');
});

test('outside the number\'s active hours the send is deferred until it wakes up', async () => {
  const device: FakeDeviceRow = {
    id: 'device-night', tenant_id: 'tenant-1', device_key: 'WAPI-NIGHT', status: 'online', health_score: 50,
    created_at: new Date('2026-09-24T04:00:00Z'), warmup_started_at: null, warmup_completed_at: null, paused_until: null,
  };
  const decision = await canSendMessage('WAPI-NIGHT', {
    queryFn: makeFakeQueryFn(device, 0), isProactive: false, content: 'Halo',
    now: new Date('2026-09-23T20:00:00Z'), // 03:00 WIB
  });
  assert.equal(decision.reason, 'outside_sending_window');
  assert.ok((decision.retryAfterMs ?? 0) >= 3 * 3_600_000, `retry ${decision.retryAfterMs}`);
});

function urgentFixture(id: string): FakeDeviceRow {
  return {
    id, tenant_id: 'tenant-1', device_key: id.toUpperCase(), status: 'online', health_score: 50,
    created_at: new Date('2026-09-24T04:00:00Z'), warmup_started_at: null, warmup_completed_at: null, paused_until: null,
  };
}

test('urgent (OTP) sends skip active hours, rests, opt-out, content rules and artificial delay', async () => {
  const device = urgentFixture('device-otp');
  const now = new Date('2026-09-23T20:00:00Z'); // 03:00 WIB, outside any active window
  const base = makeFakeQueryFn(device, 0);
  const queryFn: QueryFn = async (text, params) => {
    if (text.includes('LAG(at)')) return { rows: [{ burst_start: new Date(now.getTime() - 600_000), burst_count: 100, last_at: new Date(now.getTime() - 5_000) }] };
    if (text.includes('SELECT 1 FROM messages') && text.includes('content ~*')) return { rows: [{ '?column?': 1 }] };
    return base(text, params);
  };
  const otp = { queryFn, isProactive: true, recipient: '6281234567890', content: 'KODE ANDA 123456 JANGAN BERIKAN KE SIAPAPUN', now };

  const normal = await canSendMessage('DEVICE-OTP', { ...otp, priority: 'normal' });
  assert.equal(normal.allowed, false);

  const urgent = await canSendMessage('DEVICE-OTP', { ...otp, priority: 'urgent' });
  assert.equal(urgent.allowed, true, `denied: ${urgent.reason}`);
  assert.equal(urgent.delayMs, 0);
  assert.equal(urgent.typing.shouldSimulate, false);
});

test('urgent sends still respect paused/banned devices and the daily cap', async () => {
  const banned = { ...urgentFixture('device-otp-banned'), status: 'banned' };
  const b = await canSendMessage('DEVICE-OTP-BANNED', { queryFn: makeFakeQueryFn(banned, 0), priority: 'urgent', isProactive: true });
  assert.equal(b.reason, 'device_banned');

  const capped = urgentFixture('device-otp-cap');
  const c = await canSendMessage('DEVICE-OTP-CAP', {
    queryFn: makeFakeQueryFn(capped, 999), priority: 'urgent', isProactive: true, now: new Date('2026-09-24T05:00:00Z'),
  });
  assert.equal(c.allowed, false);
  assert.equal(c.reason, 'daily_cap_reached');
});

test('a 24-hour number keeps sending at night, and a flat delay is exactly that delay', async () => {
  const device = urgentFixture('device-24h');
  const base = makeFakeQueryFn(device, 0);
  const queryFn: QueryFn = async (text, params) => {
    if (text.includes('FROM device_personas WHERE device_id')) {
      return { rows: [{
        seed: 's', timezone: 'Asia/Jakarta', wake_hour: 7, sleep_hour: 22, delay_min_ms: 5000, delay_max_ms: 5000,
        burst_size: 15, rest_min_ms: 300000, rest_max_ms: 600000, typing_ms_per_char: 55, always_on: true,
      }] };
    }
    return base(text, params);
  };
  const decision = await canSendMessage('DEVICE-24H', {
    queryFn, isProactive: false, content: 'Halo Kak', now: new Date('2026-09-23T20:00:00Z'), // 03:00 WIB
  });
  assert.equal(decision.allowed, true, `denied: ${decision.reason}`);
  assert.equal(decision.delayMs, 5000);
});
