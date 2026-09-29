import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { UnrecoverableError, type Job } from 'bullmq';
import Redis from 'ioredis';
import type { WASocket } from '@whiskeysockets/baileys';
import type { Logger } from 'winston';
import pool from '../shared/database/connection';
import { getOrCreatePersona } from '../shared/persona';
import { createBroadcast } from '../api-gateway/routes/broadcast.routes';
import { enqueueCommand } from '../api-gateway/services/command.service';
import { queueMessage, releaseHeldMessages, retryMessage, sweepQuotaHolds } from '../api-gateway/services/message.service';
import { ServiceError } from '../api-gateway/services/service-error';
import { processAutoReply, type AutoReplyRule } from './auto-reply';
import { CommandRunner } from './command-runner';
import { closeQueueResources, deadLetterQueueName, enqueueMessage, processJob, queueName, urgentQueueName, type QueueProcessorDeps } from './queue';
import { checkTransmission, isDefinitelyNotSent } from './send-guard';
import type { AntiBanDecision } from './anti-ban';
import { Queue } from 'bullmq';

// STACK-local: real PostgreSQL and Redis (disposable), a FAKE WhatsApp transport that only records calls. No Baileys socket, no number.
const enabled = process.env['OUTBOUND_GUARD_TEST'] === '1';
if (enabled) assert.ok(['none', undefined, ''].includes(process.env['EMAIL_TRANSPORT']) && !process.env['GMAIL_OAUTH_REFRESH_TOKEN'], 'email must stay pinned off');
const root = path.join(__dirname, '../..');
const log = { debug() {}, info() {}, warn() {}, error() {} } as unknown as Logger;
const query = (text: string, params?: unknown[]) => pool.query(text, params) as unknown as Promise<{ rows: Record<string, unknown>[] }>;

test('isDefinitelyNotSent: only a closed connection proves the message did not leave', () => {
  assert.equal(isDefinitelyNotSent(Object.assign(new Error('Connection Closed'), { output: { statusCode: 428 } })), true);
  assert.equal(isDefinitelyNotSent(new Error('Connection Closed')), true);
  assert.equal(isDefinitelyNotSent(new Error('WhatsApp socket is not connected')), true);
  for (const uncertain of [new Error('Timed Out'), Object.assign(new Error('Timed Out'), { output: { statusCode: 408 } }), new Error('boom'), 'string error', undefined]) {
    assert.equal(isDefinitelyNotSent(uncertain), false, String(uncertain));
  }
});

test('outbound controls: suspension, pause, last check, urgent, retry, commands, auto-reply, isolation (disposable DB + Redis, fake transport)', { skip: !enabled }, async (t) => {
  const url = new URL(process.env['DATABASE_URL']!);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname === '/operator_test', 'Refusing non-test database');
  const redis = new Redis(process.env['REDIS_URL']!, { maxRetriesPerRequest: null });
  const extraQueues: Queue[] = [];
  t.after(async () => { for (const q of extraQueues) await q.close(); await closeQueueResources(); await redis.quit(); await pool.end(); });

  // ---- fixtures ---------------------------------------------------------------------------------------------------------------
  const key = () => `T${randomUUID().replace(/-/g, '').slice(0, 12)}`; // real keys look like WAPI-XXXXXXXX (messages.from_number is varchar(20))
  async function workspace(plan: { status?: string; end?: string } = {}, tenantStatus = 'active') {
    const id = randomUUID();
    await pool.query("INSERT INTO tenants(id,name,email,api_key,webhook_secret,status) VALUES ($1,'Uji',$2,$3,$4,$5)", [id, `${id}@example.test`, `k-${id}`, `w-${id}`, tenantStatus]);
    await pool.query(`INSERT INTO subscriptions(tenant_id,plan_id,status,cycle,period_start,period_end) VALUES ($1,'umkm',$2,'monthly',now()-interval '10 days', now() + $3::interval)
      ON CONFLICT (tenant_id) DO UPDATE SET status=$2, period_end=now()+$3::interval`, [id, plan.status ?? 'active', plan.end ?? '20 days']);
    return id;
  }
  async function device(tenantId: string, status = 'online') {
    const deviceKey = key();
    const id = (await pool.query<{ id: string }>("INSERT INTO devices(tenant_id,device_key,label,status) VALUES ($1,$2,'Uji',$3) RETURNING id", [tenantId, deviceKey, status])).rows[0]!.id;
    return { id, deviceKey, tenantId };
  }
  async function message(d: { id: string; deviceKey: string; tenantId: string }, priority: 'normal' | 'urgent' = 'normal', status = 'queued') {
    return (await pool.query<{ id: string }>(
      `INSERT INTO messages(tenant_id,device_id,device_key,to_number,content,type,status,priority,direction) VALUES ($1,$2,$3,'6281234567890','halo uji','text',$4,$5,'outbound') RETURNING id`,
      [d.tenantId, d.id, d.deviceKey, status, priority])).rows[0]!.id;
  }
  const setPlan = (tenantId: string, status: string, end = '20 days') => pool.query("UPDATE subscriptions SET status=$2, period_end=now()+$3::interval WHERE tenant_id=$1", [tenantId, status, end]);
  const row = async (id: string) => (await pool.query('SELECT status, error_message FROM messages WHERE id=$1', [id])).rows[0];

  interface Transport { calls: Array<{ jid: string; content: unknown }>; presence: string[]; sock: WASocket; failWith?: Error }
  function transport(): Transport {
    const tr: Transport = { calls: [], presence: [], sock: undefined as unknown as WASocket };
    tr.sock = {
      user: { id: '6281100000000:1@s.whatsapp.net', name: 'Uji' },
      sendMessage: async (jid: string, content: unknown) => { if (tr.failWith) throw tr.failWith; tr.calls.push({ jid, content }); return { key: { id: `wa-${tr.calls.length}` } }; },
      sendPresenceUpdate: async (kind: string) => { tr.presence.push(kind); },
      readMessages: async () => undefined,
    } as unknown as WASocket;
    return tr;
  }
  const allow = async (): Promise<AntiBanDecision> => ({ allowed: true, delayMs: 0, typing: { shouldSimulate: false, durationMs: 0 }, healthScore: 90, dailyCap: 100, sentToday: 0, warmupDay: 10 });
  const deps = (tr: Transport, over: Partial<QueueProcessorDeps> = {}): QueueProcessorDeps => ({ getSocket: () => tr.sock, isConnected: () => true, canSend: async () => allow(), delay: async () => undefined, ...over });
  const job = (messageId: string, over: Record<string, unknown> = {}) => ({ id: `job-${messageId}`, data: { messageId }, attemptsMade: 0, opts: { attempts: 3 }, ...over }) as unknown as Job<{ messageId: string }>;
  const run = (j: Job<{ messageId: string }>, d: { deviceKey: string }, tr: Transport, over: Partial<QueueProcessorDeps> = {}) => processJob(j, d.deviceKey, deps(tr, over), redis, query, log);
  const rejectsUnrecoverable = (p: Promise<void>) => assert.rejects(p, (e) => e instanceof UnrecoverableError);
  const delayedFor = async (deviceKey: string) => {
    const q = new Queue(deviceKey, { connection: redis, prefix: 'queue:messages' }); extraQueues.push(q);
    return (await q.getJobs(['delayed', 'waiting'])).map((j) => j.data.messageId);
  };

  await t.test('workspace suspended AFTER enqueue: the queued job is cancelled, never sent, no retry (normal and urgent queues)', async () => {
    const ws = await workspace(); const d = await device(ws);
    for (const priority of ['normal', 'urgent'] as const) {
      const tr = transport();
      const id = await message(d, priority);
      await setPlan(ws, 'active');
      await setPlan(ws, 'suspended'); // the state changes between enqueue and execution
      await rejectsUnrecoverable(run(job(id), d, tr));
      assert.equal(tr.calls.length, 0, `${priority}: nothing handed to the transport`);
      assert.deepEqual(await row(id), { status: 'failed', error_message: 'workspace_suspended' });
      assert.equal((await delayedFor(d.deviceKey)).includes(id), false, 'and it is not parked for later either');
    }
    // Also through the bot's own enqueue path: the guard is at execution, so an enqueue that slipped through is still stopped.
    const tr = transport();
    const viaBot = await enqueueMessage(d.deviceKey, { to: '6281234567890', type: 'text', content: 'halo', priority: 'urgent' }, redis, query);
    await rejectsUnrecoverable(run(job(viaBot), d, tr));
    assert.equal(tr.calls.length, 0); assert.equal((await row(viaBot)).error_message, 'workspace_suspended');
  });

  await t.test('what counts as suspended: expired/suspended/cancelled plans and non-active tenants block; trial, active and past_due-in-grace still send', async () => {
    const cases: Array<[string, Parameters<typeof workspace>, boolean]> = [
      ['active', [{}], true], ['trial', [{ status: 'trial' }], true], ['past_due within grace', [{ status: 'active', end: '-2 days' }], true],
      ['past grace', [{ status: 'active', end: '-30 days' }], false], ['suspended', [{ status: 'suspended' }], false], ['expired', [{ status: 'expired' }], false],
      ['cancelled', [{ status: 'cancelled' }], false], ['tenant suspended', [{}, 'suspended'], false], ['tenant deleted', [{}, 'deleted'], false],
    ];
    for (const [label, args, sends] of cases) {
      const ws = await workspace(...args); const d = await device(ws); const tr = transport(); const id = await message(d);
      const decision = await checkTransmission(d.deviceKey, query);
      assert.equal(decision.allowed, sends, label);
      if (sends) { await run(job(id), d, tr); assert.equal(tr.calls.length, 1, label); assert.equal((await row(id)).status, 'sent'); }
      else { await rejectsUnrecoverable(run(job(id), d, tr)); assert.equal(tr.calls.length, 0, label); assert.equal(decision.reason, 'workspace_suspended'); }
    }
    assert.deepEqual(await checkTransmission('NO-SUCH-DEVICE', query), { allowed: false, reason: 'device_not_found' });
  });

  await t.test('device paused before execution: normal is DEFERRED (one delayed job), urgent is CANCELLED; after resume it goes out exactly once', async () => {
    const ws = await workspace(); const d = await device(ws, 'paused'); const tr = transport();
    const normal = await message(d), urgent = await message(d, 'urgent');
    await run(job(normal), d, tr); // the current job ends normally
    assert.equal(tr.calls.length, 0);
    assert.deepEqual(await row(normal), { status: 'queued', error_message: 'device_paused' });
    assert.deepEqual(await delayedFor(d.deviceKey), [normal], 'exactly one live delayed job carries it');
    await rejectsUnrecoverable(run(job(urgent), d, tr));
    assert.deepEqual(await row(urgent), { status: 'failed', error_message: 'device_paused' });
    // Auto-pause (paused_until) behaves the same as an administrative pause.
    await pool.query("UPDATE devices SET status='online', paused_until = now() + interval '1 hour' WHERE id=$1", [d.id]);
    assert.equal((await checkTransmission(d.deviceKey, query)).reason, 'device_paused');
    // Recovery: resume, the deferred job runs again; a second run of the same message sends nothing more.
    await pool.query("UPDATE devices SET status='online', paused_until = NULL WHERE id=$1", [d.id]);
    await run(job(normal), d, tr);
    assert.equal(tr.calls.length, 1); assert.equal((await row(normal)).status, 'sent');
    await run(job(normal), d, tr);
    assert.equal(tr.calls.length, 1, 'no duplicate: an already-sent message is skipped');
    assert.equal((await row(urgent)).status, 'failed', 'the cancelled urgent message is not revived by the resume');
    assert.equal(tr.calls.filter((c) => JSON.stringify(c.content).includes('halo uji')).length, 1);
  });

  await t.test('LAST CHECK: suspension or pause that lands during the pacing delay still stops the send', async () => {
    const ws = await workspace(); const d = await device(ws);
    let tr = transport(); let id = await message(d);
    await rejectsUnrecoverable(run(job(id), d, tr, { canSend: async () => ({ ...(await allow()), delayMs: 2000 }), delay: async () => { await setPlan(ws, 'suspended'); } }));
    assert.equal(tr.calls.length, 0); assert.equal((await row(id)).error_message, 'workspace_suspended');
    await setPlan(ws, 'active');
    tr = transport(); id = await message(d);
    await run(job(id), d, tr, { canSend: async () => ({ ...(await allow()), delayMs: 2000 }), delay: async () => { await pool.query("UPDATE devices SET status='paused' WHERE id=$1", [d.id]); } });
    assert.equal(tr.calls.length, 0); assert.deepEqual(await row(id), { status: 'queued', error_message: 'device_paused' });
    // The check happens even when the state was fine at the start: proves it is a second, independent check.
    await pool.query("UPDATE devices SET status='online' WHERE id=$1", [d.id]);
    tr = transport(); id = await message(d, 'urgent');
    await run(job(id), d, tr, { canSend: async () => ({ ...(await allow()), delayMs: 1 }), delay: async () => undefined });
    assert.equal(tr.calls.length, 1);
  });

  await t.test('isolation: suspending one workspace never touches another workspace or its numbers', async () => {
    const a = await workspace({ status: 'suspended' }); const b = await workspace();
    const da = await device(a), db_ = await device(b);
    const ta = transport(), tb = transport();
    const ma = await message(da), mb = await message(db_);
    await rejectsUnrecoverable(run(job(ma), da, ta));
    await run(job(mb), db_, tb);
    assert.equal(ta.calls.length, 0); assert.equal(tb.calls.length, 1);
    assert.equal((await row(mb)).status, 'sent'); assert.equal((await row(ma)).error_message, 'workspace_suspended');
    // A message row of workspace A cannot be pushed through B's device by key confusion: the guard reads the device's own workspace.
    assert.equal((await checkTransmission(da.deviceKey, query)).allowed, false);
    assert.equal((await checkTransmission(db_.deviceKey, query)).allowed, true);
  });

  await t.test('uncertain outcome: a timeout is never retried automatically; a closed connection (nothing left the socket) may be', async () => {
    const ws = await workspace(); const d = await device(ws);
    const tr = transport(); const id = await message(d);
    tr.failWith = Object.assign(new Error('Timed Out'), { output: { statusCode: 408 } });
    await rejectsUnrecoverable(run(job(id), d, tr));
    assert.deepEqual(await row(id), { status: 'failed', error_message: 'delivery_uncertain' });
    const dead = new Queue(deadLetterQueueName(d.deviceKey), { connection: redis, prefix: 'queue:messages' }); extraQueues.push(dead);
    assert.equal((await dead.getJobs(['waiting'])).length, 1, 'kept for inspection');
    // A definite non-send goes through the normal retry path (an ordinary Error, so BullMQ retries it).
    const tr2 = transport(); const id2 = await message(d);
    tr2.failWith = Object.assign(new Error('Connection Closed'), { output: { statusCode: 428 } });
    await assert.rejects(run(job(id2), d, tr2), (e) => e instanceof Error && !(e instanceof UnrecoverableError));
    assert.equal((await row(id2)).status, 'queued', 'still queued for the retry');
  });

  await t.test('recovery without duplication: a cancelled message is not resent by itself; one manual retry sends it once; retry needs a live plan and an online number', async () => {
    const ws = await workspace(); const d = await device(ws); const tr = transport();
    const id = await message(d);
    await setPlan(ws, 'suspended');
    await rejectsUnrecoverable(run(job(id), d, tr));
    await setPlan(ws, 'active'); // recovery
    assert.deepEqual(await delayedFor(d.deviceKey), [], 'nothing reappears in the queue on its own');
    assert.equal(tr.calls.length, 0);
    // retry while still suspended is refused and changes nothing
    await setPlan(ws, 'suspended');
    await assert.rejects(retryMessage(ws, id), (e) => e instanceof ServiceError && e.status === 402 && e.code === 'PLAN_INACTIVE');
    assert.equal((await row(id)).status, 'failed');
    await setPlan(ws, 'active');
    await pool.query("UPDATE devices SET status='paused' WHERE id=$1", [d.id]);
    await assert.rejects(retryMessage(ws, id), (e) => e instanceof ServiceError && e.code === 'DEVICE_OFFLINE');
    await pool.query("UPDATE devices SET status='online' WHERE id=$1", [d.id]);
    await assert.rejects(retryMessage('00000000-0000-4000-8000-000000000000', id), (e) => e instanceof ServiceError, 'another tenant cannot retry it');
    await retryMessage(ws, id);
    await assert.rejects(retryMessage(ws, id), (e) => e instanceof ServiceError && e.code === 'MESSAGE_NOT_RETRYABLE', 'a second click is refused');
    assert.equal((await delayedFor(d.deviceKey)).filter((m) => m === id).length, 1, 'exactly one job');
    await run(job(id), d, tr);
    assert.equal(tr.calls.length, 1);
    await run(job(id), d, tr);
    assert.equal(tr.calls.length, 1, 'still once');
  });

  await t.test('broadcast: a suspended workspace queues nothing; an active one queues each recipient once', async () => {
    const ws = await workspace({ status: 'suspended' }); const d = await device(ws);
    const call = (tenantId: string, body: unknown) => {
      let out: { status?: number; body?: unknown } = {};
      const res = { status(code: number) { out.status = code; return this; }, json(b: unknown) { out.body = b; return this; } };
      return createBroadcast({ validated: { body }, tenant: { id: tenantId } } as never, res as never).then(() => out);
    };
    const body = { device_key: d.deviceKey, recipients: ['6281111111111', '6281111111112'], message: 'halo', media_type: 'image' };
    await assert.rejects(call(ws, body), (e) => e instanceof ServiceError && e.code === 'PLAN_INACTIVE');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM messages WHERE device_key=$1', [d.deviceKey])).rows[0].n, 0);
    await setPlan(ws, 'active');
    const ok = await call(ws, body) as { status: number; body: { data: { queued: number } } };
    assert.equal(ok.status, 202); assert.equal(ok.body.data.queued, 2);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM messages WHERE device_key=$1', [d.deviceKey])).rows[0].n, 2);
  });

  await t.test('device commands that WRITE to WhatsApp: refused at the API for a suspended workspace or paused number, cancelled at the runner, reads stay available', async () => {
    const ws = await workspace(); const d = await device(ws);
    const payload = { kind: 'text', text: 'promo', audience: 'list', numbers: ['6281234567890'] };
    // API side
    await setPlan(ws, 'suspended');
    for (const [type, body] of [['status.post', payload], ['profile.update', { about: 'x' }], ['profile.picture', {}]] as const) {
      await assert.rejects(enqueueCommand(ws, d.deviceKey, type, body), (e) => e instanceof ServiceError && e.code === 'PLAN_INACTIVE', type);
    }
    assert.equal((await enqueueCommand(ws, d.deviceKey, 'profile.get', {})).status, 'queued', 'a read is still allowed');
    await setPlan(ws, 'active');
    await pool.query("UPDATE devices SET status='paused' WHERE id=$1", [d.id]);
    await assert.rejects(enqueueCommand(ws, d.deviceKey, 'status.post', payload), (e) => e instanceof ServiceError && e.code === 'DEVICE_PAUSED');
    await pool.query("UPDATE devices SET status='online' WHERE id=$1", [d.id]);
    // Runner side: queued while fine, workspace suspended before it runs -> failed WORKSPACE_SUSPENDED, nothing written.
    await pool.query('DELETE FROM device_commands WHERE device_key=$1', [d.deviceKey]);
    const tr = transport();
    const runner = new CommandRunner(d.deviceKey, query, () => tr.sock, () => true, undefined, redis, log);
    const queued = await enqueueCommand(ws, d.deviceKey, 'status.post', payload);
    await setPlan(ws, 'suspended');
    await runner.tick();
    const failed = (await pool.query('SELECT status, error FROM device_commands WHERE id=$1', [queued.id])).rows[0];
    assert.equal(failed.status, 'failed'); assert.match(failed.error, /^WORKSPACE_SUSPENDED:/);
    assert.equal(tr.calls.length, 0);
    // LAST CHECK inside the command: the suspension lands while the number is going online, right before the post.
    await setPlan(ws, 'active');
    await getOrCreatePersona(d.id, query); await pool.query('UPDATE device_personas SET always_on = true WHERE device_id=$1', [d.id]);
    const slow = { ensureOnline: async () => { await setPlan(ws, 'suspended'); }, afterSend: async () => undefined };
    const runner2 = new CommandRunner(d.deviceKey, query, () => tr.sock, () => true, slow as never, redis, log);
    const second = await enqueueCommand(ws, d.deviceKey, 'status.post', payload).catch(async () => { await setPlan(ws, 'active'); return enqueueCommand(ws, d.deviceKey, 'status.post', payload); });
    await setPlan(ws, 'active');
    await runner2.tick();
    const failed2 = (await pool.query('SELECT status, error FROM device_commands WHERE id=$1', [second.id])).rows[0];
    assert.equal(failed2.status, 'failed'); assert.match(failed2.error, /^WORKSPACE_SUSPENDED:/);
    assert.equal(tr.calls.length, 0, 'the post never reached the transport');
    // Recovery: a fresh command by the person after the workspace is active again goes out exactly once; the cancelled ones do not reappear.
    await setPlan(ws, 'active');
    const runner3 = new CommandRunner(d.deviceKey, query, () => tr.sock, () => true, undefined, redis, log);
    await enqueueCommand(ws, d.deviceKey, 'status.post', payload);
    await runner3.tick(); await runner3.tick();
    assert.equal(tr.calls.length, 1);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM device_commands WHERE device_key=$1 AND status='failed'", [d.deviceKey])).rows[0].n, 2);
  });

  await t.test('auto-reply: not sent for a suspended workspace or paused number, stopped at the last check, other workspaces unaffected, no retroactive reply', async () => {
    const a = await workspace(); const b = await workspace();
    const da = await device(a), db_ = await device(b);
    const rule = async (tenantId: string, deviceKey: string): Promise<AutoReplyRule> => {
      const id = (await pool.query<{ id: string }>("INSERT INTO auto_reply_rules(tenant_id,device_key,trigger_type,trigger_pattern,response_type,response_content,delay_ms) VALUES ($1,$2,'all','','text','balasan otomatis',0) RETURNING id", [tenantId, deviceKey])).rows[0]!.id;
      return { id, tenant_id: tenantId, device_key: deviceKey, trigger: { type: 'all', pattern: '' }, response: { type: 'text', content: 'balasan otomatis', delay_ms: 0 }, is_active: true };
    };
    const incoming = async (d: { id: string; deviceKey: string; tenantId: string }) => {
      const id = (await pool.query<{ id: string }>("INSERT INTO messages(tenant_id,device_id,device_key,from_number,to_number,content,type,status,direction) VALUES ($1,$2,$3,'6281299999999','6281100000000','halo','text','received','inbound') RETURNING id", [d.tenantId, d.id, d.deviceKey])).rows[0]!.id;
      return { id, tenantId: d.tenantId, deviceId: d.id, deviceKey: d.deviceKey, from: '6281299999999', content: 'halo', isGroup: false, replyJid: '6281299999999@s.whatsapp.net' } as never;
    };
    const logs = async (deviceKey: string) => (await pool.query('SELECT status, error_message FROM auto_reply_logs WHERE device_key=$1 ORDER BY created_at', [deviceKey])).rows;
    const opts = { canSend: async () => allow(), wait: async () => undefined };
    // active: sends
    const t1 = transport();
    assert.equal(await processAutoReply(await incoming(da), [await rule(a, da.deviceKey)], t1.sock, query, log, opts), true);
    assert.equal(t1.calls.length, 1);
    // suspended: blocked and logged, nothing sent
    await setPlan(a, 'suspended');
    const t2 = transport();
    assert.equal(await processAutoReply(await incoming(da), [await rule(a, da.deviceKey)], t2.sock, query, log, opts), false);
    assert.equal(t2.calls.length, 0);
    assert.deepEqual((await logs(da.deviceKey)).at(-1), { status: 'blocked', error_message: 'workspace_suspended' });
    // last check: the suspension arrives while it is "typing"
    await setPlan(a, 'active');
    const t3 = transport();
    const waitAndSuspend = async () => { await setPlan(a, 'suspended'); };
    assert.equal(await processAutoReply(await incoming(da), [await rule(a, da.deviceKey)], t3.sock, query, log, { canSend: async () => allow(), wait: waitAndSuspend }), false);
    assert.equal(t3.calls.length, 0);
    assert.deepEqual((await logs(da.deviceKey)).at(-1), { status: 'blocked', error_message: 'workspace_suspended' });
    // paused number
    await setPlan(a, 'active'); await pool.query("UPDATE devices SET status='paused' WHERE id=$1", [da.id]);
    const t4 = transport();
    assert.equal(await processAutoReply(await incoming(da), [await rule(a, da.deviceKey)], t4.sock, query, log, opts), false);
    assert.equal(t4.calls.length, 0); assert.equal((await logs(da.deviceKey)).at(-1)!.error_message, 'device_paused');
    // isolation: workspace B kept replying throughout, and a message of A never triggers B's rule
    const t5 = transport();
    assert.equal(await processAutoReply(await incoming(db_), [await rule(b, db_.deviceKey)], t5.sock, query, log, opts), true);
    assert.equal(await processAutoReply(await incoming(da), [await rule(b, db_.deviceKey)], transport().sock, query, log, opts), false, "another workspace's rule never answers");
    // recovery: nothing is replayed for the messages that arrived while blocked
    await pool.query("UPDATE devices SET status='online' WHERE id=$1", [da.id]);
    assert.equal(t2.calls.length + t3.calls.length + t4.calls.length, 0);
    assert.equal((await logs(da.deviceKey)).filter((l) => l.status === 'sent').length, 1, 'only the very first reply exists');
  });

  await t.test('the queue names used by the gateway and the worker agree (urgent traffic has its own queue but the same guard)', () => {
    assert.equal(queueName('K1'), 'K1'); assert.equal(urgentQueueName('K1'), 'K1-urgent');
    assert.ok(root.length > 0);
  });

  // ---- T1.1: hard quota holds instead of dropping, transactional exemption, release ------------------------------
  const setQuota = (tenantId: string, quota: number, used: number) =>
    pool.query('UPDATE tenants SET quota_messages=$2, used_messages=$3, usage_period_start=now()-interval \'1 day\' WHERE id=$1', [tenantId, quota, used]);
  const send = (d: { deviceKey: string; tenantId: string }, over: Partial<Parameters<typeof queueMessage>[1]> = {}) =>
    queueMessage(d.tenantId, { device_key: d.deviceKey, to: '6281234567890', message: 'halo uji', ...over });

  await t.test('over quota: the message is HELD, never dropped or silently failed, and does not count as sent', async () => {
    const ws = await workspace(); const d = await device(ws);
    await setQuota(ws, 5, 5); // already at the cap
    const result = await send(d);
    assert.equal(result.status, 'quota_hold');
    assert.equal((await row(result.id))?.status, 'quota_hold', 'held in the database, not failed/blocked');
    const tenant = (await pool.query<{ used_messages: number }>('SELECT used_messages FROM tenants WHERE id=$1', [ws])).rows[0]!;
    assert.equal(tenant.used_messages, 5, 'a held message is not counted as used');
  });

  await t.test('OTP/transactional exemption: a server-verified code bypasses the hard quota and is never held', async () => {
    const ws = await workspace(); const d = await device(ws);
    await setQuota(ws, 5, 5); // already at the cap -- a normal send would be held
    const result = await send(d, { message: 'Kode OTP Anda: 482913', otp_code: '482913' });
    assert.equal(result.status, 'queued', 'exempt sends are never held even at the cap');
    assert.equal(result.quota_exempt, true);
    const tenant = (await pool.query<{ used_messages: number }>('SELECT used_messages FROM tenants WHERE id=$1', [ws])).rows[0]!;
    assert.equal(tenant.used_messages, 5, 'exempt sends never increment used_messages');
  });

  await t.test('the exemption is not just `priority: urgent`: setting urgent alone still counts against quota and can be held', async () => {
    const ws = await workspace(); const d = await device(ws);
    await setQuota(ws, 5, 5);
    const result = await send(d, { priority: 'urgent' }); // no otp_code at all
    assert.equal(result.status, 'quota_hold', 'priority alone never grants the exemption');
  });

  await t.test('the exemption is not a free-form flag: the code must actually be inside the message, short, and without media', async () => {
    const ws = await workspace(); const d = await device(ws);
    await setQuota(ws, 5, 5);
    const detached = await send(d, { message: 'Halo, ini pesan biasa', otp_code: '482913' }); // code not in message
    assert.equal(detached.status, 'quota_hold');
    const withMedia = await send(d, { message: 'Kode OTP: 482913', otp_code: '482913', media_url: 'https://example.test/x.png' });
    assert.equal(withMedia.status, 'quota_hold', 'a code alongside media is not treated as a short transactional message');
  });

  await t.test('the exemption itself is rate-limited per recipient: repeated claims stop being exempt and fall back to counting against quota', async () => {
    const ws = await workspace(); const d = await device(ws);
    await setQuota(ws, 1000, 0);
    let exemptCount = 0; let heldOrQueuedNormally = 0;
    for (let i = 0; i < 6; i += 1) {
      const r = await send(d, { message: `Kode OTP Anda: ${100000 + i}`, otp_code: String(100000 + i) });
      if (r.quota_exempt) exemptCount += 1; else heldOrQueuedNormally += 1;
    }
    assert.ok(exemptCount <= 3, `at most the configured per-recipient limit should be exempt, got ${exemptCount}`);
    assert.ok(heldOrQueuedNormally > 0, 'once the limit is spent, further "OTP" sends are no longer exempt -- they are not rejected either');
  });

  await t.test('releaseHeldMessages: a held message is promoted to queued, in order, once the tenant has headroom again', async () => {
    const ws = await workspace(); const d = await device(ws);
    await setQuota(ws, 5, 5);
    const first = await send(d, { message: 'pesan pertama tertahan' });
    const second = await send(d, { message: 'pesan kedua tertahan' });
    assert.equal(first.status, 'quota_hold'); assert.equal(second.status, 'quota_hold');
    await setQuota(ws, 5, 4); // one slot of headroom opens up (e.g. after a plan change)
    const released = await releaseHeldMessages(ws);
    assert.equal(released.released, 1, 'only as many as there is headroom for');
    assert.equal((await row(first.id))?.status, 'queued', 'oldest held message first');
    assert.equal((await row(second.id))?.status, 'quota_hold', 'the rest stays held, not dropped');
    const tenant = (await pool.query<{ used_messages: number }>('SELECT used_messages FROM tenants WHERE id=$1', [ws])).rows[0]!;
    assert.equal(tenant.used_messages, 5);
  });

  await t.test('sweepQuotaHolds releases across every tenant that has a hold, never touching an unrelated workspace', async () => {
    const wsA = await workspace(); const dA = await device(wsA);
    const wsB = await workspace(); const dB = await device(wsB);
    await setQuota(wsA, 5, 5); await setQuota(wsB, 5, 5);
    const heldA = await send(dA); const heldB = await send(dB);
    assert.equal(heldA.status, 'quota_hold'); assert.equal(heldB.status, 'quota_hold');
    await setQuota(wsA, 5, 4); // only A gets headroom
    const swept = await sweepQuotaHolds();
    assert.ok(swept.released >= 1);
    assert.equal((await row(heldA.id))?.status, 'queued');
    assert.equal((await row(heldB.id))?.status, 'quota_hold', 'B never had headroom, so it is untouched by A\'s release');
  });
});
