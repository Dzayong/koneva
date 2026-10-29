import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { UnrecoverableError, type Job } from 'bullmq';
import Redis from 'ioredis';
import { WAMessageStatus, type WASocket, type WAMessage } from '@whiskeysockets/baileys';
import type { Logger } from 'winston';
import pool from '../shared/database/connection';
import { getOrCreatePersona } from '../shared/persona';
import { createBroadcast } from '../api-gateway/routes/broadcast.routes';
import { tenantAuth, authorize } from '../api-gateway/middleware/auth';
import messageRoutes from '../api-gateway/routes/message.routes';
import { enqueueCommand } from '../api-gateway/services/command.service';
import { queueMessage, releaseHeldMessages, retryMessage, sweepQuotaHolds } from '../api-gateway/services/message.service';
import { ServiceError } from '../api-gateway/services/service-error';
import { processAutoReply, type AutoReplyRule } from './auto-reply';
import { handleIncomingMessage, sendStopConfirmation } from './incoming';
import { CommandRunner } from './command-runner';
import { closeQueueResources, deadLetterQueueName, enqueueMessage, handleReceiptUpdate, processJob, queueName, startQueueProcessor, urgentQueueName, type QueueProcessorDeps } from './queue';
import { checkTransmission, isDefinitelyNotSent } from './send-guard';
import { countMessagesSince, type AntiBanDecision } from './anti-ban';
import { acquireDeviceProcessLease } from '../shared/device-process-lease';
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
  const processLease = await acquireDeviceProcessLease(pool, 'WAPI-LEASE-TEST');
  await assert.rejects(acquireDeviceProcessLease(pool, 'wapi-lease-test'), /already owns device/);
  await processLease.release();
  const nextLease = await acquireDeviceProcessLease(pool, 'WAPI-LEASE-TEST');
  await nextLease.release();
  const redis = new Redis(process.env['REDIS_URL']!, { maxRetriesPerRequest: null });
  const extraQueues: Queue[] = [];
  t.after(async () => { for (const q of extraQueues) await q.close(); await closeQueueResources(); await redis.quit(); await pool.end(); });

  // ---- fixtures ---------------------------------------------------------------------------------------------------------------
  const key = () => `T${randomUUID().replace(/-/g, '').slice(0, 12)}`; // real keys look like WAPI-XXXXXXXX (messages.from_number is varchar(20))
  async function workspace(plan: { status?: string; end?: string } = {}, tenantStatus = 'active') {
    const id = randomUUID();
    await pool.query("INSERT INTO tenants(id,name,email,webhook_secret,status) VALUES ($1,'Uji',$2,$3,$4)", [id, `${id}@example.test`, `w-${id}`, tenantStatus]);
    await pool.query(`INSERT INTO subscriptions(tenant_id,plan_id,status,cycle,period_start,period_end) VALUES ($1,'umkm',$2,'monthly',now()-interval '10 days', now() + $3::interval)
      ON CONFLICT (tenant_id) DO UPDATE SET status=$2, period_end=now()+$3::interval`, [id, plan.status ?? 'active', plan.end ?? '20 days']);
    await pool.query(`INSERT INTO recipient_preferences(tenant_id,phone_number,status,source,evidence_ref)
      VALUES ($1,'6281234567890','opted_in','inbound_keyword',$2)`, [id, `fixture:${id}`]);
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
  const allow = async (): Promise<AntiBanDecision> => ({ allowed: true, delayMs: 0, typing: { shouldSimulate: false, durationMs: 0 }, healthScore: 90, dailyCap: 100, sentToday: 0 });
  const deps = (tr: Transport, over: Partial<QueueProcessorDeps> = {}): QueueProcessorDeps => ({ getSocket: () => tr.sock, isConnected: () => true, canSend: async () => allow(), delay: async () => undefined, ...over });
  const job = (messageId: string, over: Record<string, unknown> = {}) => ({ id: `job-${messageId}`, data: { messageId }, attemptsMade: 0, opts: { attempts: 3 }, ...over }) as unknown as Job<{ messageId: string }>;
  const run = async (j: Job<{ messageId: string }>, d: { deviceKey: string }, tr: Transport, over: Partial<QueueProcessorDeps> = {}) => {
    await processJob(j, d.deviceKey, deps(tr, over), redis, query, log);
    const msg = (await pool.query<{ whatsapp_message_id: string | null; status: string }>(
      'SELECT whatsapp_message_id, status FROM messages WHERE id=$1', [j.data.messageId],
    )).rows[0];
    // The fake transport can model WhatsApp's server ACK explicitly after the socket write.
    if (msg?.status === 'sending' && msg.whatsapp_message_id) await handleReceiptUpdate({
      key: { id: msg.whatsapp_message_id, remoteJid: '6281234567890@s.whatsapp.net', fromMe: true },
      update: { status: WAMessageStatus.SERVER_ACK },
    }, query, log);
  };
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

  await t.test('device paused before execution: caller urgent is not trusted, so both messages defer and send once after resume', async () => {
    const ws = await workspace(); const d = await device(ws, 'paused'); const tr = transport();
    const normal = await message(d), urgent = await message(d, 'urgent');
    await run(job(normal), d, tr); // the current job ends normally
    assert.equal(tr.calls.length, 0);
    assert.deepEqual(await row(normal), { status: 'queued', error_message: 'device_paused' });
    assert.deepEqual(await delayedFor(d.deviceKey), [normal], 'exactly one live delayed job carries it');
    await run(job(urgent), d, tr);
    assert.deepEqual(await row(urgent), { status: 'queued', error_message: 'device_paused' });
    // Auto-pause (paused_until) behaves the same as an administrative pause.
    await pool.query("UPDATE devices SET status='online', paused_until = now() + interval '1 hour' WHERE id=$1", [d.id]);
    assert.equal((await checkTransmission(d.deviceKey, query)).reason, 'device_paused');
    // Recovery: resume, the deferred job runs again; a second run of the same message sends nothing more.
    await pool.query("UPDATE devices SET status='online', paused_until = NULL WHERE id=$1", [d.id]);
    await run(job(normal), d, tr);
    assert.equal(tr.calls.length, 1); assert.equal((await row(normal)).status, 'sent');
    await run(job(urgent), d, tr);
    assert.equal(tr.calls.length, 2); assert.equal((await row(urgent)).status, 'sent');
    await run(job(normal), d, tr);
    assert.equal(tr.calls.length, 2, 'no duplicate: an already-sent message is skipped');
    assert.equal(tr.calls.filter((c) => JSON.stringify(c.content).includes('halo uji')).length, 2);
  });

  await t.test('queued messages expire even when a live retry job remains, and never reach WhatsApp late', async () => {
    const ws = await workspace(); const d = await device(ws); const tr = transport();
    const normal = await message(d);
    await pool.query("UPDATE messages SET queue_started_at=now()-interval '16 minutes' WHERE id=$1", [normal]);
    await rejectsUnrecoverable(run(job(normal), d, tr));
    assert.equal(tr.calls.length, 0);
    assert.deepEqual(await row(normal), { status: 'failed', error_message: 'queue_expired' });

    const urgent = await message(d, 'urgent');
    await pool.query("UPDATE messages SET quota_exempt=true, queue_started_at=now()-interval '3 minutes' WHERE id=$1", [urgent]);
    await rejectsUnrecoverable(run(job(urgent), d, tr));
    assert.equal(tr.calls.length, 0, 'urgent messages have a shorter expiry window');
    assert.deepEqual(await row(urgent), { status: 'failed', error_message: 'queue_expired' });
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
    await assert.rejects(
      retryMessage(ws, id),
      (error) => error instanceof ServiceError && error.status === 409 && error.code === 'DELIVERY_UNCERTAIN_MANUAL_REVIEW_REQUIRED',
      'a message WhatsApp may have accepted must not be blindly sent again',
    );
    assert.deepEqual(await row(id), { status: 'failed', error_message: 'delivery_uncertain' });
    assert.equal((await delayedFor(d.deviceKey)).filter((messageId) => messageId === id).length, 0, 'manual retry must not enqueue an uncertain message');
    const dead = new Queue(deadLetterQueueName(d.deviceKey), { connection: redis, prefix: 'queue:messages' }); extraQueues.push(dead);
    assert.equal((await dead.getJobs(['waiting'])).length, 1, 'kept for inspection');
    // A definite non-send goes through the normal retry path (an ordinary Error, so BullMQ retries it).
    const tr2 = transport(); const id2 = await message(d);
    tr2.failWith = Object.assign(new Error('Connection Closed'), { output: { statusCode: 428 } });
    await assert.rejects(run(job(id2), d, tr2), (e) => e instanceof Error && !(e instanceof UnrecoverableError));
    assert.equal((await row(id2)).status, 'queued', 'still queued for the retry');
  });

  await t.test('WhatsApp acceptance followed by a lost ACK write cannot cause an automatic duplicate', async () => {
    const ws = await workspace(); const d = await device(ws); const tr = transport();
    const id = await message(d);
    let failNextSentUpdate = true;
    const failFinalWrite: typeof query = async (sql, params) => {
      if (failNextSentUpdate && sql.includes("SET status = $1, sent_at = COALESCE") && params?.[0] === 'sent') {
        failNextSentUpdate = false;
        throw new Error('injected database failure after WhatsApp accepted the message');
      }
      return query(sql, params);
    };
    await processJob(job(id), d.deviceKey, deps(tr), redis, query, log);
    const pending = (await pool.query<{ whatsapp_message_id: string }>('SELECT whatsapp_message_id FROM messages WHERE id=$1', [id])).rows[0]!;
    await assert.rejects(handleReceiptUpdate({
      key: { id: pending.whatsapp_message_id, remoteJid: '6281234567890@s.whatsapp.net', fromMe: true },
      update: { status: WAMessageStatus.SERVER_ACK },
    }, failFinalWrite, log), /injected database failure/);
    assert.equal(tr.calls.length, 1);
    assert.deepEqual(await row(id), { status: 'sending', error_message: null }, 'a failed ACK write leaves the durable send claim pending');
    assert.equal(await countMessagesSince(d.id, new Date(Date.now() - 60_000), query), 1, 'pending sends still reserve the budget');
    await processJob(job(id, { attemptsMade: 1 }), d.deviceKey, deps(tr), redis, query, log);
    assert.equal(tr.calls.length, 1, 'BullMQ retry observes sending and does not call WhatsApp again');
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
    const call = (tenantId: string, body: unknown, idempotencyKey = 'broadcast-test-key-001') => {
      let out: { status?: number; body?: unknown } = {};
      const res = { status(code: number) { out.status = code; return this; }, json(b: unknown) { out.body = b; return this; } };
      return createBroadcast({ validated: { body }, tenant: { id: tenantId }, get: (name: string) => name.toLowerCase() === 'idempotency-key' ? idempotencyKey : undefined } as never, res as never).then(() => out);
    };
    const body = { device_key: d.deviceKey, recipients: ['6281111111111', '6281111111112'], message: 'halo', media_type: 'image' };
    await assert.rejects(call(ws, body), (e) => e instanceof ServiceError && e.code === 'PLAN_INACTIVE');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM messages WHERE device_key=$1', [d.deviceKey])).rows[0].n, 0);
    await setPlan(ws, 'active');
    await pool.query(`INSERT INTO recipient_preferences(tenant_id,phone_number,status,source,evidence_ref)
      VALUES ($1,'6281111111111','opted_in','inbound_keyword','broadcast-fixture-1'),
             ($1,'6281111111112','opted_in','inbound_keyword','broadcast-fixture-2')`, [ws]);
    const ok = await call(ws, body) as { status: number; body: { data: { queued: number; broadcast_id: string } } };
    assert.equal(ok.status, 202); assert.equal(ok.body.data.queued, 2);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM messages WHERE device_key=$1', [d.deviceKey])).rows[0].n, 2);
    const replay = await call(ws, body) as { status: number; body: { data: { broadcast_id: string } } };
    assert.equal(replay.status, 202);
    assert.equal(replay.body.data.broadcast_id, ok.body.data.broadcast_id);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM messages WHERE device_key=$1', [d.deviceKey])).rows[0].n, 2, 'a broadcast replay reuses the original recipient messages');
    await assert.rejects(call(ws, { ...body, message: 'isi berbeda' }), (error) => error instanceof ServiceError && error.code === 'IDEMPOTENCY_KEY_CONFLICT');
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
      return { id, tenant_id: tenantId, device_key: deviceKey, trigger: { type: 'all', pattern: '' }, response: { type: 'text', content: 'balasan otomatis', delay_ms: 0 }, destination_scope: 'all' as const, is_active: true };
    };
    const incoming = async (d: { id: string; deviceKey: string; tenantId: string }) => {
      await pool.query(`INSERT INTO recipient_preferences(tenant_id,phone_number,status,source,evidence_ref)
        VALUES ($1,'6281299999999','opted_in','inbound_keyword',$2) ON CONFLICT (tenant_id,phone_number) DO NOTHING`, [d.tenantId, `reply-fixture:${d.tenantId}`]);
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

  await t.test('normal, urgent and auto-reply sends share the per-device budget and never overlap', async () => {
    const ws = await workspace(); const d = await device(ws); const tr = transport();
    const inbound = await pool.query<{ id: string }>(
      `INSERT INTO messages(tenant_id,device_id,device_key,from_number,to_number,chat_jid,content,type,status,direction)
       VALUES ($1,$2,$3,'6281234567890','6281100000000','6281234567890@s.whatsapp.net','halo','text','received','inbound') RETURNING id`,
      [ws, d.id, d.deviceKey],
    );
    const ruleId = (await pool.query<{ id: string }>(
      "INSERT INTO auto_reply_rules(tenant_id,device_key,trigger_type,trigger_pattern,response_type,response_content,delay_ms) VALUES ($1,$2,'all','','text','balasan otomatis',0) RETURNING id",
      [ws, d.deviceKey],
    )).rows[0]!.id;
    const autoRule: AutoReplyRule = {
      id: ruleId, tenant_id: ws, device_key: d.deviceKey,
      trigger: { type: 'all', pattern: '' }, response: { type: 'text', content: 'balasan otomatis', delay_ms: 0 }, destination_scope: 'all', is_active: true,
    };
    const autoMessage = {
      id: inbound.rows[0]!.id, tenantId: ws, deviceId: d.id, deviceKey: d.deviceKey,
      from: '6281234567890', content: 'halo', replyJid: '6281234567890@s.whatsapp.net', isGroup: false,
    } as never;
    let active = 0; let maximumActive = 0;
    tr.sock.sendMessage = async (jid: string, content: unknown) => {
      active += 1; maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      tr.calls.push({ jid, content }); active -= 1;
      return { key: { id: `mixed-${tr.calls.length}` } } as never;
    };
    const decision = async (): Promise<AntiBanDecision> => {
      const sent = await countMessagesSince(d.id, new Date(Date.now() - 60_000), query);
      return sent >= 2
        ? { allowed: false, reason: 'rate_limit_per_minute', delayMs: 0, typing: { shouldSimulate: false, durationMs: 0 }, healthScore: 90, dailyCap: 20, sentToday: sent }
        : { ...await allow(), sentToday: sent, dailyCap: 20 };
    };
    const normalId = await message(d);
    const urgentId = await message(d, 'urgent');
    const jobs = [
      run(job(normalId), d, tr, { canSend: decision }),
      run(job(urgentId), d, tr, { canSend: decision }),
      processAutoReply(autoMessage, [autoRule], tr.sock, query, log, { canSend: decision, wait: async () => undefined }),
    ];
    const settled = await Promise.all(jobs);
    assert.equal(tr.calls.length, 2, 'the combined 1-minute budget allows only two sends');
    assert.equal(maximumActive, 1, 'the device transport is never called concurrently');
    assert.equal(await countMessagesSince(d.id, new Date(Date.now() - 60_000), query), 2);
  });

  await t.test('sustained API enqueue and real BullMQ workers across synthetic tenants', { skip: process.env['OUTBOUND_SUSTAINED_TEST'] !== '1' }, async () => {
    const fixtures = await Promise.all(Array.from({ length: 10 }, async () => {
      const tenantId = await workspace();
      const d = await device(tenantId);
      const inboundId = (await pool.query<{ id: string }>(
        `INSERT INTO messages(tenant_id,device_id,device_key,from_number,to_number,chat_jid,content,type,status,direction)
         VALUES ($1,$2,$3,'6281234567890','6281100000000','6281234567890@s.whatsapp.net','uji','text','received','inbound') RETURNING id`,
        [tenantId, d.id, d.deviceKey],
      )).rows[0]!.id;
      const token = `wgk_${randomBytes(32).toString('base64url')}`;
      await pool.query('INSERT INTO api_keys(tenant_id,name,prefix,key_hash,scopes) VALUES ($1,\'sustained-load\',$2,$3,ARRAY[\'messages:send\']::text[])', [
        tenantId, token.slice(0, 12), createHash('sha256').update(token).digest('hex'),
      ]);
      return { d, inboundId, token, tr: transport() };
    }));

    const workers = fixtures.map(({ d, tr }) => startQueueProcessor(d.deviceKey, redis, {
      getSocket: () => tr.sock,
      isConnected: () => true,
      canSend: allow,
      delay: async () => undefined,
    }, log, query));
    const app = express();
    app.use(express.json());
    app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: false, legacyHeaders: false }));
    app.use('/api/v1', tenantAuth, authorize, messageRoutes);
    app.use(((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
      response.status(error instanceof ServiceError ? error.status : 500).json({ error: error instanceof Error ? error.message : String(error) });
    }) as express.ErrorRequestHandler);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const endpoint = `http://127.0.0.1:${address.port}/api/v1/message/send`;
    const sentIds: string[] = [];
    const latencies: number[] = [];
    const startedAt = Date.now();

    try {
      // 18 waves × 10 users, six seconds apart = 180 accepted requests at
      // 100/minute, below the shared-IP 120/minute limiter. Each send enters
      // BullMQ and is drained by a real worker connected to fake transport.
      for (let wave = 0; wave < 18; wave += 1) {
        const dueAt = startedAt + wave * 6_000;
        if (Date.now() < dueAt) await new Promise((resolve) => setTimeout(resolve, dueAt - Date.now()));
        const batch = await Promise.all(fixtures.map(async ({ d, inboundId, token }) => {
          const requestStarted = Date.now();
          const response = await fetch(endpoint, {
            method: 'POST', headers: { apikey: token, 'content-type': 'application/json' },
            body: JSON.stringify({ device_key: d.deviceKey, to: '6281234567890', message: `steady wave ${wave}`, reply_to_message_id: inboundId }),
          });
          const body = await response.json() as { data?: { message_id?: string } };
          return { status: response.status, latency: Date.now() - requestStarted, id: body.data?.message_id };
        }));
        const rejected = batch.filter((result) => result.status !== 202);
        assert.equal(rejected.length, 0, `wave ${wave} had rejected requests: ${JSON.stringify(rejected)}`);
        assert.ok(batch.every((result) => result.id), 'every accepted response includes a message ID');
        sentIds.push(...batch.map((result) => result.id!));
        latencies.push(...batch.map((result) => result.latency));
      }

      const deliveryDeadline = Date.now() + 30_000;
      while (Date.now() < deliveryDeadline) {
        const state = await pool.query<{ sent: number; pending: number }>(
          `SELECT count(*) FILTER (WHERE status='sent')::int AS sent,
                  count(*) FILTER (WHERE status IN ('queued','sending'))::int AS pending
           FROM messages WHERE id=ANY($1::uuid[])`, [sentIds],
        );
        if (state.rows[0]?.sent === sentIds.length) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const final = await pool.query<{ sent: number; pending: number; failed: number }>(
        `SELECT count(*) FILTER (WHERE status='sent')::int AS sent,
                count(*) FILTER (WHERE status IN ('queued','sending'))::int AS pending,
                count(*) FILTER (WHERE status NOT IN ('sent','queued','sending'))::int AS failed
         FROM messages WHERE id=ANY($1::uuid[])`, [sentIds],
      );
      const sortedLatency = latencies.sort((a, b) => a - b);
      const p95 = sortedLatency[Math.ceil(sortedLatency.length * 0.95) - 1]!;
      const fakeCalls = fixtures.reduce((sum, fixture) => sum + fixture.tr.calls.length, 0);
      assert.deepEqual(final.rows[0], { sent: 180, pending: 0, failed: 0 });
      assert.equal(fakeCalls, 180, 'each accepted queue job reaches fake transport exactly once');
      assert.ok(p95 < 2_000, `API enqueue p95 exceeded 2s: ${p95}ms`);
      console.log(`Sustained synthetic load: requests=180 durationMs=${Date.now() - startedAt} apiP95Ms=${p95} sent=${final.rows[0]!.sent} fakeCalls=${fakeCalls}`);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await Promise.all(workers.map((worker) => worker.stop()));
    }
  });

  await t.test('100 concurrent authenticated API requests enqueue and deliver on isolated test devices', async () => {
    const tenants = await Promise.all(Array.from({ length: 100 }, () => workspace()));
    const fixtures = await Promise.all(tenants.map(async (tenantId) => {
      const d = await device(tenantId);
      const inboundId = (await pool.query<{ id: string }>(
        `INSERT INTO messages(tenant_id,device_id,device_key,from_number,to_number,chat_jid,content,type,status,direction)
         VALUES ($1,$2,$3,'6281234567890','6281100000000','6281234567890@s.whatsapp.net','halo','text','received','inbound') RETURNING id`,
        [tenantId, d.id, d.deviceKey],
      )).rows[0]!.id;
      const token = `wgk_${randomBytes(32).toString('base64url')}`;
      const hash = createHash('sha256').update(token).digest('hex');
      await pool.query("INSERT INTO api_keys(tenant_id,name,prefix,key_hash,scopes) VALUES ($1,'isolated-load',$2,$3,ARRAY['messages:send']::text[])", [tenantId, token.slice(0, 12), hash]);
      return { tenantId, d, inboundId, token };
    }));

    const app = express();
    app.use(express.json());
    app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: false, legacyHeaders: false }));
    app.use('/api/v1', tenantAuth, authorize, messageRoutes);
    app.use(((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
      response.status(error instanceof ServiceError ? error.status : 500).json({ error: error instanceof Error ? error.message : String(error) });
    }) as express.ErrorRequestHandler);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const endpoint = `http://127.0.0.1:${address.port}/api/v1/message/send`;
    try {
      const startedAt = Date.now();
      const responses = await Promise.all(fixtures.map(async ({ d, inboundId, token }) => {
        const requestStartedAt = Date.now();
        const response = await fetch(endpoint, {
          method: 'POST', headers: { apikey: token, 'content-type': 'application/json' },
          body: JSON.stringify({ device_key: d.deviceKey, to: '6281234567890', message: 'balasan uji beban', reply_to_message_id: inboundId }),
        });
        return { status: response.status, durationMs: Date.now() - requestStartedAt, body: await response.json() as { data?: { message_id?: string } } };
      }));
      assert.equal(responses.filter((response) => response.status === 202).length, 100, `all authenticated API requests enqueue successfully; failed: ${JSON.stringify(responses.filter((response) => response.status !== 202).slice(0, 8))}`);
      const sortedLatency = responses.map((response) => response.durationMs).sort((a, b) => a - b);
      const p95 = sortedLatency[Math.ceil(sortedLatency.length * 0.95) - 1]!;
      assert.ok(p95 < 10_000, `API p95 was ${p95}ms; 100 requests completed in ${Date.now() - startedAt}ms`);
      const messageIds = responses.map((response) => response.body.data?.message_id);
      assert.equal(new Set(messageIds).size, 100, 'each request gets a separate message row');
      const tr = transport(); let active = 0; let maximumActive = 0;
      tr.sock.sendMessage = async (jid: string, content: unknown) => {
        active += 1; maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        tr.calls.push({ jid, content }); active -= 1;
        return { key: { id: `load-${tr.calls.length}` } } as never;
      };
      // Each device container has its own worker, and each process has a
      // bounded worker count. Exercise all 100 deliveries in waves of eight
      // to avoid pretending one process owns 100 independent device sockets.
      for (let offset = 0; offset < fixtures.length; offset += 8) {
        await Promise.all(fixtures.slice(offset, offset + 8).map(({ d }, batchIndex) => {
          const index = offset + batchIndex;
          return processJob(
            job(messageIds[index]!), d.deviceKey,
            { getSocket: () => tr.sock, isConnected: () => true, delay: async () => undefined },
            redis, query, log,
          );
        }));
      }
      const correlations = (await pool.query<{ whatsapp_message_id: string; device_key: string }>(
        'SELECT whatsapp_message_id, device_key FROM messages WHERE id = ANY($1::uuid[])', [messageIds],
      )).rows;
      await Promise.all(correlations.map(({ whatsapp_message_id: id }) => handleReceiptUpdate({
        key: { id, remoteJid: '6281234567890@s.whatsapp.net', fromMe: true },
        update: { status: WAMessageStatus.SERVER_ACK },
      }, query, log)));
      assert.equal(tr.calls.length, 100, 'all queued messages reach the fake transport once');
      assert.ok(maximumActive > 1, 'independent devices can make progress concurrently');
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM messages WHERE id = ANY($1::uuid[]) AND status = 'sent'", [messageIds])).rows[0]!.n, 100);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  await t.test('STOP is stored before replies, blocks pending promo and is acknowledged at most once; START opts back in without reviving old jobs', async () => {
    const ws = await workspace(); const d = await device(ws); const tr = transport();
    const pending = await message(d);
    const inbound = (id: string, content: string) => ({
      key: { remoteJid: '6281234567890@s.whatsapp.net', participant: '', fromMe: false, id },
      message: { conversation: content }, messageTimestamp: 1_790_000_000,
    } as unknown as WAMessage);
    const order: string[] = [];
    const stop = await handleIncomingMessage(inbound('WA-STOP-1', 'STOP!!!'), d.deviceKey, query, log,
      async () => { order.push('webhook'); },
      async (saved) => { order.push('ack'); await sendStopConfirmation(saved, tr.sock, log); });
    assert.equal(stop?.consentCommand, 'stop');
    assert.deepEqual(order, ['ack', 'webhook'], 'the single STOP confirmation is attempted before webhook delivery');
    assert.equal((await pool.query('SELECT status FROM recipient_preferences WHERE tenant_id=$1 AND phone_number=$2', [ws, '6281234567890'])).rows[0]?.status, 'opted_out');
    assert.deepEqual(await row(pending), { status: 'blocked', error_message: 'recipient_opted_out' });
    await run(job(pending), d, tr);
    assert.equal(tr.calls.length, 1, 'the blocked pending promo adds no transport call beyond the STOP acknowledgement');
    await sendStopConfirmation(stop!, tr.sock, log);
    assert.equal(tr.calls.length, 1, 'only one acknowledgement attempt is recorded for this STOP inbound id');
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM messages WHERE tenant_id=$1 AND external_id=$2", [ws, `consent-stop:${stop!.whatsappMessageId}`])).rows[0]?.n, 1);

    const start = await handleIncomingMessage(inbound('WA-START-1', '(MULAI)'), d.deviceKey, query, log, async () => undefined);
    assert.equal(start?.consentCommand, 'start');
    assert.equal((await pool.query('SELECT status FROM recipient_preferences WHERE tenant_id=$1 AND phone_number=$2', [ws, '6281234567890'])).rows[0]?.status, 'opted_in');
    assert.equal((await row(pending)).status, 'blocked', 'START never resurrects a message suppressed by STOP');
    await assert.rejects(retryMessage(ws, pending), (error) => error instanceof ServiceError && error.code === 'RECIPIENT_CONSENT_SUPPRESSED');
    const fresh = await message(d);
    await run(job(fresh), d, tr);
    assert.equal(tr.calls.length, 2, 'a new promotional message after START can proceed');
  });

  await t.test('internal bot send endpoint helper rejects a recipient without recorded consent before insert', async () => {
    const ws = await workspace(); const d = await device(ws);
    await assert.rejects(
      enqueueMessage(d.deviceKey, { to: '6281999999999', type: 'text', content: 'promo' }, redis, query),
      (error: unknown) => error instanceof Error && 'statusCode' in error && error.statusCode === 409 && 'code' in error && error.code === 'recipient_consent_required',
    );
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM messages WHERE tenant_id=$1 AND to_number=$2', [ws, '6281999999999'])).rows[0]?.n, 0);
  });

  await t.test('concurrent duplicate inbound message IDs persist once and trigger one webhook', async () => {
    const ws = await workspace(); const d = await device(ws);
    const whatsappMessageId = `wa-in-${randomUUID()}`;
    const inbound = {
      key: { remoteJid: '6281234567890@s.whatsapp.net', participant: '', fromMe: false, id: whatsappMessageId },
      message: { conversation: 'pesan uji dedupe' }, messageTimestamp: Math.floor(Date.now() / 1000),
    } as unknown as WAMessage;
    let webhookCalls = 0;
    const receive = () => handleIncomingMessage(inbound, d.deviceKey, query, log, async () => { webhookCalls += 1; });
    const records = await Promise.all([receive(), receive()]);
    assert.equal(records.filter(Boolean).length, 1);
    assert.equal(webhookCalls, 1);
    const count = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM messages WHERE device_key=$1 AND whatsapp_message_id=$2 AND direction=\'inbound\'',
      [d.deviceKey, whatsappMessageId],
    );
    assert.equal(count.rows[0]?.n, 1);
  });

  await t.test('a STOP that lands while a queued worker is pacing wins before the final transport check', async () => {
    const ws = await workspace(); const d = await device(ws); const tr = transport(); const pending = await message(d);
    const slow = async (): Promise<AntiBanDecision> => ({ ...(await allow()), delayMs: 1 });
    await rejectsUnrecoverable(run(job(pending), d, tr, {
      canSend: slow,
      delay: async () => { await pool.query("UPDATE recipient_preferences SET status='opted_out' WHERE tenant_id=$1 AND phone_number='6281234567890'", [ws]); },
    }));
    assert.equal(tr.calls.length, 0);
    assert.deepEqual(await row(pending), { status: 'blocked', error_message: 'recipient_opted_out' });
  });

  await t.test('the queue names used by the gateway and the worker agree (urgent traffic has its own queue but the same guard)', () => {
    assert.equal(queueName('K1'), 'K1'); assert.equal(urgentQueueName('K1'), 'K1-urgent');
    assert.ok(root.length > 0);
  });

  // ---- T1.1: hard quota holds instead of dropping; only internal system sends are exempt -------------------------
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

  await t.test('tenant-supplied otp_code cannot bypass the hard quota', async () => {
    const ws = await workspace(); const d = await device(ws);
    await setQuota(ws, 5, 5); // already at the cap -- a normal send would be held
    const result = await queueMessage(ws, {
      device_key: d.deviceKey, to: '6281234567890', message: 'Kode OTP Anda: 482913', otp_code: '482913',
    } as Parameters<typeof queueMessage>[1]);
    assert.equal(result.status, 'quota_hold');
    assert.equal(result.quota_exempt, false);
  });

  await t.test('a tenant-scoped external_id is idempotent and rejects changed payloads', async () => {
    const ws = await workspace(); const d = await device(ws);
    await setQuota(ws, 100, 0);
    const externalId = `retry-${randomUUID()}`;
    const input = { device_key: d.deviceKey, to: '6281234567890', message: 'satu pesan', external_id: externalId };
    const first = await queueMessage(ws, input);
    const replay = await queueMessage(ws, input);
    assert.equal(replay.id, first.id);
    const rows = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM messages WHERE tenant_id=$1 AND external_id=$2', [ws, externalId]);
    assert.equal(rows.rows[0]?.n, 1);
    await assert.rejects(() => queueMessage(ws, { ...input, message: 'isi berbeda' }), (error) => error instanceof ServiceError && error.code === 'IDEMPOTENCY_KEY_CONFLICT');
  });

  await t.test('the exemption is not just `priority: urgent`: setting urgent alone still counts against quota and can be held', async () => {
    const ws = await workspace(); const d = await device(ws);
    await setQuota(ws, 5, 5);
    const result = await send(d, { priority: 'urgent' }); // no otp_code at all
    assert.equal(result.status, 'quota_hold', 'priority alone never grants the exemption');
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
