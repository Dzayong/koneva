import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WAMessageKey, WASocket } from '@whiskeysockets/baileys';
import type { Logger } from 'winston';
import { PresenceRoutine, type PresenceSettings } from './presence';

const log = { debug: () => undefined } as unknown as Logger;
const key = (id: string): WAMessageKey => ({ id, remoteJid: '628111@s.whatsapp.net', fromMe: false });

function harness(settings: PresenceSettings, randoms: number[] = [0.5]) {
  const events: string[] = [];
  const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
  const sock = {
    sendPresenceUpdate: async (kind: string) => { events.push(`presence:${kind}`); },
    readMessages: async (keys: WAMessageKey[]) => { events.push(`read:${keys.map((k) => k.id).join(',')}`); },
  } as unknown as WASocket;
  let i = 0;
  const waits: number[] = [];
  const routine = new PresenceRoutine(() => sock, async () => settings, log, {
    random: () => randoms[i++ % randoms.length]!,
    wait: async (ms) => { waits.push(ms); events.push(`wait`); },
    setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearTimer: (h) => { (h as { cleared: boolean }).cleared = true; },
  });
  return { routine, events, timers, waits };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('incoming message: pause, online, pause, read, then a scheduled offline', async () => {
  const h = harness({ enabled: true, minMs: 1_000, maxMs: 200_000 });
  assert.equal(await h.routine.onInbound(key('m1')), true);
  await flush(); await flush();
  assert.deepEqual(h.events, ['wait', 'presence:available', 'wait', 'read:m1']);
  const offline = h.timers.filter((t) => !t.cleared);
  assert.equal(offline.length, 1);
  offline[0]!.fn();
  await flush();
  assert.equal(h.events.at(-1), 'presence:unavailable');
});

test('every pause stays inside the configured bounds', async () => {
  const h = harness({ enabled: true, minMs: 5_000, maxMs: 9_000 }, [0, 1, 0.5]);
  await h.routine.onInbound(key('m1'));
  await flush(); await flush();
  for (const ms of [...h.waits, ...h.timers.map((t) => t.ms)]) assert.ok(ms >= 5_000 && ms <= 9_000, `${ms} outside bounds`);
});

test('messages arriving during the routine are read together in the same visit', async () => {
  const h = harness({ enabled: true, minMs: 1_000, maxMs: 2_000 });
  await h.routine.onInbound(key('a'));
  await h.routine.onInbound(key('b'));
  await flush(); await flush();
  assert.equal(h.events.filter((e) => e === 'presence:available').length, 1);
  assert.ok(h.events.includes('read:a,b'));
});

test('disabled: nothing is sent and the caller keeps reading responsibility', async () => {
  const h = harness({ enabled: false, minMs: 1_000, maxMs: 2_000 });
  assert.equal(await h.routine.onInbound(key('m1')), false);
  await h.routine.beforeReply(key('m1'));
  await h.routine.afterSend();
  await flush();
  assert.deepEqual(h.events, []);
});

test('replying goes online first, reads the message, and cancels a pending offline', async () => {
  const h = harness({ enabled: true, minMs: 1_000, maxMs: 2_000 });
  await h.routine.afterSend();
  const pendingOffline = h.timers[0]!;
  await h.routine.beforeReply(key('m1'));
  assert.equal(pendingOffline.cleared, true);
  assert.deepEqual(h.events, ['presence:available', 'read:m1']);
});

test('sending goes online once and then schedules going offline', async () => {
  const h = harness({ enabled: true, minMs: 1_000, maxMs: 2_000 });
  await h.routine.ensureOnline();
  await h.routine.ensureOnline();
  assert.equal(h.events.filter((e) => e === 'presence:available').length, 1);
  await h.routine.afterSend();
  assert.equal(h.timers.filter((t) => !t.cleared).length, 1);
});
