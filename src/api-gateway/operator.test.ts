import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import express from 'express';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import type { AddressInfo } from 'node:net';
import pool from '../shared/database/connection';
import { createOperatorRouter } from './operator/router';
import { csrfFor } from './operator/auth';
import { hash } from './operator/core';
import { execFileSync } from 'node:child_process';
import { requestStudentVerification, sweepStudentVerificationDeadlines } from './services/billing.service';
import adminRoutes from './routes/admin.routes';
import { adminAuth } from './middleware/auth';

const enabled = process.env['OPERATOR_STACK_TEST'] === '1';
test('operator HTTP + PostgreSQL contract (disposable database only)', { skip: !enabled }, async (t) => {
  const url = new URL(process.env['DATABASE_URL']!);
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname) && url.pathname === '/operator_test', 'Refusing non-test database');
  const origin = 'http://localhost:13000';
  const config = { enabled: true, origin, cookieName: 'koneva_op_test', secure: false, requestsPerMinute: 100_000 };
  await pool.query('CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY)');
  const executed = new Set((await pool.query<{ name: string }>('SELECT name FROM _migrations')).rows.map((r) => r.name));
  const dir = path.join(__dirname, '../../migrations');
  for (const file of (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
    if (executed.has(file)) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(await fs.readFile(path.join(dir, file), 'utf8'));
      await client.query('INSERT INTO _migrations(name) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  for (const file of ['030_operator_owner_audit_ip.sql', '031_application_database_role.sql', '036_operator_login_success_event.sql', '037_owner_insights_any_operator.sql', '038_owner_unique_index.sql']) {
    const sql = await fs.readFile(path.join(dir, file), 'utf8');
    await pool.query(sql);
    await pool.query(sql);
  }
  const app = express();
  app.use('/operator', createOperatorRouter(pool, config));
  app.use('/admin', adminAuth, adminRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); await pool.end(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/operator`;
  const allPermissions = ['payments:read','payments:confirm','students:read','students:decide','workspaces:read','audit:read'];
  const ownerPermissions = [...allPermissions, 'owner:insights'];
  const testPassword = 'synthetic-test-password-26';
  const passwordHash = await bcrypt.hash(testPassword, 12);
  async function operator(permissions = allPermissions, isOwner = false) {
    const id = randomUUID(), token = randomBytes(32).toString('hex'), email = `${id}@example.test`;
    await pool.query('INSERT INTO operators(id,email,name,password_hash,permissions,is_owner) VALUES ($1,$2,$3,$4,$5,$6)',
      [id,email,'Operator Uji',passwordHash,permissions,isOwner]);
    await pool.query('INSERT INTO operator_sessions(token_hash,operator_id) VALUES ($1,$2)', [hash(token),id]);
    return { id,email,token,cookie: `${config.cookieName}=${token}`,csrf: csrfFor(token) };
  }
  const op = await operator(), other = await operator();
  const phaseAOwner = await operator(ownerPermissions, true);
  await t.test('the runtime privilege role may insert audit but cannot alter/delete it and is not superuser', async () => {
    const roles = await pool.query<{ app_superuser: boolean; grant_superuser: boolean; can_insert: boolean; can_update: boolean; can_delete: boolean; can_change_break_glass: boolean; can_change_permissions: boolean; can_change_mfa: boolean }>(
      `SELECT app.rolsuper AS app_superuser, grant_role.rolsuper AS grant_superuser,
        has_table_privilege('koneva_application','operator_audit','INSERT') AS can_insert,
        has_table_privilege('koneva_application','operator_audit','UPDATE') AS can_update,
        has_table_privilege('koneva_application','operator_audit','DELETE') AS can_delete,
        has_column_privilege('koneva_application','operators','is_break_glass','UPDATE') AS can_change_break_glass,
        has_column_privilege('koneva_application','operators','permissions','UPDATE') AS can_change_permissions,
        has_column_privilege('koneva_application','operators','mfa_last_step','UPDATE') AS can_change_mfa
       FROM pg_roles app CROSS JOIN pg_roles grant_role WHERE app.rolname='koneva_app' AND grant_role.rolname='koneva_application'`);
    assert.equal(roles.rows[0]?.app_superuser, false);
    assert.equal(roles.rows[0]?.grant_superuser, false);
    assert.equal(roles.rows[0]?.can_insert, true);
    assert.equal(roles.rows[0]?.can_update, false);
    assert.equal(roles.rows[0]?.can_delete, false);
    assert.equal(roles.rows[0]?.can_change_break_glass, false);
    assert.equal(roles.rows[0]?.can_change_permissions, false);
    assert.equal(roles.rows[0]?.can_change_mfa, true);
    const runtimePassword = randomBytes(32).toString('hex');
    execFileSync(process.execPath, ['--require', 'ts-node/register', 'scripts/configure-personal-db-role.ts'], {
      cwd: path.join(__dirname, '../..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DATABASE_URL: process.env['DATABASE_URL']!, APP_DB_PASSWORD: runtimePassword },
    });
    const runtimeUrl = new URL(process.env['DATABASE_URL']!);
    runtimeUrl.username = 'koneva_app'; runtimeUrl.password = runtimePassword;
    const runtimePool = new Pool({ connectionString: runtimeUrl.toString(), max: 1 });
    const identity = await runtimePool.query<{ current_user: string; rolsuper: boolean }>(
      'SELECT current_user, rolsuper FROM pg_roles WHERE rolname=current_user');
    assert.equal(identity.rows[0]?.current_user, 'koneva_app');
    assert.equal(identity.rows[0]?.rolsuper, false);
    try {
      const inserted = await runtimePool.query<{ id: string }>(`INSERT INTO operator_audit(operator_id,action,target_type,target_id,changes,request_id)
        VALUES ($1,'test.runtime_insert','system_insights',$2,'{}',$3) RETURNING id`, [op.id, randomUUID(), randomUUID()]);
      const id = inserted.rows[0]!.id;
      await assert.rejects(runtimePool.query('UPDATE operator_audit SET action=$2 WHERE id=$1', [id, 'tampered']), /permission denied|append only/i);
      await assert.rejects(runtimePool.query('DELETE FROM operator_audit WHERE action=$1', ['test.runtime_insert']), /permission denied|append only/i);
    } finally {
      await runtimePool.end();
    }
  });
  type Session = Pick<typeof op, 'cookie' | 'csrf'>;
  async function call(route: string, options: { session?: Session; method?: string; body?: unknown; key?: string; headers?: Record<string,string> } = {}) {
    const headers: Record<string,string> = { 'Origin': origin, 'X-Requested-With': 'koneva-operator', ...options.headers };
    if (options.session) { headers['Cookie'] = options.session.cookie; headers['X-CSRF-Token'] = options.session.csrf; }
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.key) headers['Idempotency-Key'] = options.key;
    Object.assign(headers, options.headers);
    const response = await fetch(base+route, { method: options.method ?? 'GET', headers, ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}) });
    const text = await response.text();
    return { status: response.status, headers: response.headers, text, body: text ? JSON.parse(text) : undefined };
  }
  async function workspace() {
    const id = randomUUID();
    await pool.query(`INSERT INTO tenants(id,name,email,webhook_secret,used_messages) VALUES ($1,$2,$3,$4,50)`,
      [id,`Workspace ${id}`,`${id}@example.test`,`secret-hook-${id}`]);
    const user = randomUUID();
    await pool.query('INSERT INTO users(id,email,name,password_hash) VALUES ($1,$2,$3,$4)', [user,`${user}@example.test`,'Pemilik Uji',passwordHash]);
    await pool.query("INSERT INTO memberships(user_id,tenant_id,role) VALUES ($1,$2,'owner')", [user,id]);
    return id;
  }
  async function invoice(tenant = '', plan = 'umkm') {
    const tenantId = tenant || await workspace(), id = randomUUID();
    const number = `TEST-${id.slice(0,20)}`;
    await pool.query(`INSERT INTO invoices(id,tenant_id,number,plan_id,cycle,amount_idr,due_at) VALUES ($1,$2,$3,$4,'monthly',99000,now()+interval '7 days')`, [id,tenantId,number,plan]);
    return { id,tenantId,number };
  }
  const payment = (extra = {}) => ({ method: 'transfer', expected: { amount_idr: 99000, version: 1 }, ...extra });
  const pay = (id: string, body = payment(), key = randomUUID(), session = op) => call(`/invoices/${id}/confirm-payment`, { session, method: 'POST', body, key });
  const assertCode = (result: Awaited<ReturnType<typeof call>>, status: number, code: string) => { assert.equal(result.status,status,result.text); assert.equal(result.body.error.code,code); };

  await t.test('tenant/admin credentials never authenticate operator; all errors are private/no-store', async () => {
    const result = await call('/me', { headers: { Authorization: 'Bearer wgs_synthetic', 'x-admin-key': 'operator-test-admin', Cookie: 'wa_gateway_session=synthetic' } });
    assertCode(result,401,'UNAUTHENTICATED');
    assert.equal(result.headers.get('cache-control'),'no-store'); assert.match(result.headers.get('vary')!,/Cookie/);
    assert.equal(result.headers.get('access-control-allow-origin'),null);
  });
  await t.test('login blocks foreign/missing Origin, cross-site fetch, bad JSON and missing custom header', async () => {
    for (const headers of [{ Origin: 'https://evil.example' }, { Origin: '' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
      assertCode(await call('/auth/login', { method: 'POST', body: { email: op.email,password:testPassword },headers }),403,'ORIGIN_NOT_ALLOWED');
    }
    assertCode(await call('/auth/login', { method:'POST',body:{email:op.email,password:testPassword},headers:{'X-Requested-With':''} }),400,'VALIDATION_ERROR');
    const bad = await fetch(base+'/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Requested-With':'koneva-operator'},body:'{"note":"PRIVATE'});
    assert.equal(bad.status,400); assert.ok(!(await bad.text()).includes('PRIVATE'));
  });
  await t.test('login rotates old session and returns HttpOnly Strict cookie plus in-memory CSRF', async () => {
    const account = await operator();
    const result = await call('/auth/login',{session:account,method:'POST',body:{email:account.email,password:testPassword}});
    assert.equal(result.status,200,result.text); assert.equal(result.body.data.status,'authenticated');
    assert.match(result.headers.get('set-cookie')!,/HttpOnly/); assert.match(result.headers.get('set-cookie')!,/SameSite=Strict/);
    assert.match(result.headers.get('set-cookie')!,/Path=\//); assert.ok(!result.headers.get('set-cookie')!.includes('wa_gateway_session'));
    assertCode(await call('/me',{session:account}),401,'SESSION_EXPIRED');
    const cookie = result.headers.get('set-cookie')!.split(';')[0]!;
    const next = { cookie,csrf:result.body.data.csrf_token };
    assert.equal((await call('/me',{session:next})).body.data.csrf_token,next.csrf);
    assert.equal((await call('/auth/logout',{session:next,method:'POST'})).text,'');
    assertCode(await call('/me',{session:next}),401,'SESSION_EXPIRED');
  });
  await t.test('CSRF, permissions, input and recent-login gates have no invoice effect', async () => {
    const i = await invoice();
    assertCode(await call(`/invoices/${i.id}/confirm-payment`,{session:op,method:'POST',body:payment(),key:randomUUID(),headers:{'X-CSRF-Token':'bad'}}),403,'CSRF_INVALID');
    const reader = await operator(['payments:read']);
    assertCode(await pay(i.id,payment(),randomUUID(),reader),403,'FORBIDDEN');
    assertCode(await call('/student-requests',{session:reader}),403,'FORBIDDEN');
    assertCode(await call('/invoices?limit=101',{session:op}),400,'VALIDATION_ERROR');
    assertCode(await call('/invoices/not-a-uuid',{session:op}),400,'VALIDATION_ERROR');
    assertCode(await call(`/invoices/${i.id}/confirm-payment`,{session:op,method:'POST',body:payment()}),400,'VALIDATION_ERROR');
    await pool.query("UPDATE operator_sessions SET authenticated_at=now()-interval '16 minutes' WHERE token_hash=$1",[hash(reader.token)]);
    await pool.query('UPDATE operators SET permissions=$2 WHERE id=$1',[reader.id,allPermissions]);
    assertCode(await pay(i.id,payment(),randomUUID(),reader),401,'REAUTH_REQUIRED');
    assert.equal((await pool.query('SELECT status FROM invoices WHERE id=$1',[i.id])).rows[0].status,'unpaid');
  });
  await t.test('confirmation + subscription + audit commit once; same key replays exact body and rejects reuse', async () => {
    const i=await invoice(),key=randomUUID(),body=payment({reference:' TRF-SYNTHETIC ',note:'PRIVATE_PAYMENT_NOTE'});
    const first=await pay(i.id,body,key); assert.equal(first.status,200,first.text);
    const second=await pay(i.id,body,key); assert.equal(second.status,200,second.text); assert.equal(second.text,first.text);
    assert.equal(second.headers.get('idempotent-replay'),'true');
    assertCode(await pay(i.id,payment({reference:'CHANGED'}),key),409,'IDEMPOTENCY_KEY_REUSED');
    assert.equal(first.body.data.invoice.version,2); assert.equal(first.body.data.subscription.plan,'umkm');
    const rows=(await pool.query('SELECT changes,reason FROM operator_audit WHERE target_id=$1',[i.id])).rows;
    assert.equal(rows.length,1); assert.ok(!JSON.stringify(rows).includes('PRIVATE_PAYMENT_NOTE')); assert.ok(!JSON.stringify(rows).includes('TRF-SYNTHETIC'));
    assertCode(await pay(i.id,payment(),randomUUID(),other),409,'INVOICE_NOT_PAYABLE');
  });
  await t.test('version/amount and student eligibility conflicts reject before any effect', async () => {
    const i=await invoice();
    await pool.query('UPDATE invoices SET amount_idr=100000 WHERE id=$1',[i.id]);
    const changed=await pay(i.id); assertCode(changed,409,'INVOICE_CHANGED'); assert.equal(changed.body.error.details.current.version,2);
    const student=await invoice('','pelajar'); assert.equal((await pay(student.id)).status,200,'paid Pelajar access starts while evidence verification is pending');
  });
  await t.test('normalized reference uniqueness is atomic and scoped by method', async () => {
    const a=await invoice(),b=await invoice(),reference=`REF-${randomUUID()}`;
    const results=await Promise.all([pay(a.id,payment({reference})),pay(b.id,payment({reference:` ${reference.toLowerCase()} `}))]);
    assert.deepEqual(results.map((r)=>r.status).sort(),[200,409]);
    assert.equal(results.find((r)=>r.status===409)!.body.error.code,'DUPLICATE_REFERENCE');
    const c=await invoice(); assert.equal((await pay(c.id,payment({method:'ewallet',reference}))).status,200);
  });
  await t.test('competing operators produce one payment; different invoices extend the same subscription twice', async () => {
    const i=await invoice();
    const results=await Promise.all([pay(i.id),pay(i.id,payment(),randomUUID(),other)]);
    assert.deepEqual(results.map((r)=>r.status).sort(),[200,409]);
    const tenant=await workspace(),a=await invoice(tenant),b=await invoice(tenant);
    const both=await Promise.all([pay(a.id),pay(b.id,payment(),randomUUID(),other)]);
    assert.deepEqual(both.map((r)=>r.status),[200,200]);
    const sub=(await pool.query('SELECT period_start,period_end FROM subscriptions WHERE tenant_id=$1',[tenant])).rows[0];
    assert.ok(new Date(sub.period_end).getTime()-new Date(sub.period_start).getTime()>55*86_400_000);
  });
  await t.test('a held idempotency lock returns in-progress, then a retry completes', async () => {
    const i=await invoice(),key=randomUUID(),client=await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([op.id,'invoice.confirm_payment',i.id,key])]);
      const result=await pay(i.id,payment(),key); assertCode(result,409,'REQUEST_IN_PROGRESS'); assert.equal(result.headers.get('retry-after'),'2');
    } finally {await client.query('ROLLBACK');client.release();}
    assert.equal((await pay(i.id,payment(),key)).status,200);
  });
  await t.test('audit failure rolls invoice/subscription/idempotency back, same-key retry remains possible', async () => {
    const i=await invoice(),key=randomUUID();
    await pool.query(`CREATE FUNCTION reject_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$;
      CREATE TRIGGER reject_test_audit BEFORE INSERT ON operator_audit FOR EACH ROW EXECUTE FUNCTION reject_test_audit()`);
    try {
      const result=await pay(i.id,payment(),key); assertCode(result,500,'AUDIT_FAILED'); assert.equal(result.body.error.details.rolled_back,true);
      assert.equal((await pool.query('SELECT status FROM invoices WHERE id=$1',[i.id])).rows[0].status,'unpaid');
      assert.equal((await pool.query('SELECT tenant_id FROM subscriptions WHERE tenant_id=$1',[i.tenantId])).rowCount,0);
      assert.equal((await pool.query('SELECT key FROM operator_idempotency WHERE key=$1',[key])).rowCount,0);
    } finally { await pool.query('DROP TRIGGER reject_test_audit ON operator_audit; DROP FUNCTION reject_test_audit()'); }
    assert.equal((await pay(i.id,payment(),key)).status,200);
  });
  await t.test('student resubmission keeps history, supersedes old request and limits PII to detail', async () => {
    const tenant=await workspace(),email='student@campus.example.ac.id';
    await requestStudentVerification(tenant,email,'PRIVATE_STUDENT_NOTE');
    const old=(await pool.query('SELECT id FROM student_requests WHERE tenant_id=$1',[tenant])).rows[0].id;
    await requestStudentVerification(tenant,email,'PRIVATE_NEW_NOTE');
    const current=(await pool.query("SELECT id FROM student_requests WHERE tenant_id=$1 AND status='pending'",[tenant])).rows[0].id;
    const list=await call('/student-requests?status=pending',{session:op}); assert.equal(list.status,200,list.text);
    assert.ok(!list.text.includes('PRIVATE_')); assert.ok(!list.text.includes(email));
    const detail=await call(`/student-requests/${current}`,{session:op}); assert.equal(detail.body.data.note,'PRIVATE_NEW_NOTE');
    assert.equal(detail.body.data.history[0].status,'superseded'); assert.equal(detail.body.data.academic_domain_hint,true);
    const decide=(id:string,decision='approve',reason?:string,key=randomUUID())=>call(`/student-requests/${id}/decision`,{session:op,method:'POST',key,body:{decision,...(reason?{reason}:{}),expected:{request_id:id,version:1}}});
    assertCode(await decide(old),409,'REQUEST_SUPERSEDED'); assertCode(await decide(current,'reject'),400,'REASON_REQUIRED');
    const key=randomUUID(),first=await decide(current,'approve',undefined,key); assert.equal(first.status,200,first.text);
    assert.equal((await decide(current,'approve',undefined,key)).text,first.text);
    assertCode(await decide(current,'reject','PRIVATE_REASON'),409,'REQUEST_NOT_PENDING');
    assert.ok((await pool.query('SELECT student_verified_at FROM tenants WHERE id=$1',[tenant])).rows[0].student_verified_at);
    const logs=(await pool.query('SELECT changes,reason FROM operator_audit WHERE target_id=$1',[current])).rows;
    assert.ok(!JSON.stringify(logs).includes('PRIVATE_'));
  });
  await t.test('student decision audit failure rolls the request and entitlement back', async () => {
    const tenant=await workspace();
    await requestStudentVerification(tenant,'student@campus.example.ac.id','PRIVATE_ROLLBACK_NOTE');
    const id=(await pool.query('SELECT id FROM student_requests WHERE tenant_id=$1',[tenant])).rows[0].id;
    const key=randomUUID(),body={decision:'approve',expected:{request_id:id,version:1}};
    await pool.query(`CREATE FUNCTION reject_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$;
      CREATE TRIGGER reject_test_audit BEFORE INSERT ON operator_audit FOR EACH ROW EXECUTE FUNCTION reject_test_audit()`);
    try {
      const result=await call(`/student-requests/${id}/decision`,{session:op,method:'POST',body,key});
      assertCode(result,500,'AUDIT_FAILED'); assert.equal(result.body.error.details.rolled_back,true);
      assert.equal((await pool.query('SELECT status FROM student_requests WHERE id=$1',[id])).rows[0].status,'pending');
      assert.equal((await pool.query('SELECT student_verified_at FROM tenants WHERE id=$1',[tenant])).rows[0].student_verified_at,null);
      assert.equal((await pool.query('SELECT key FROM operator_idempotency WHERE key=$1',[key])).rowCount,0);
    } finally { await pool.query('DROP TRIGGER reject_test_audit ON operator_audit; DROP FUNCTION reject_test_audit()'); }
    const results=await Promise.all([
      call(`/student-requests/${id}/decision`,{session:op,method:'POST',body,key}),
      call(`/student-requests/${id}/decision`,{session:other,method:'POST',body:{...body,decision:'reject',reason:'PRIVATE_REASON'},key:randomUUID()}),
    ]);
    assert.deepEqual(results.map((r)=>r.status).sort(),[200,409]);
    assert.equal((await pool.query('SELECT id FROM operator_audit WHERE target_id=$1',[id])).rowCount,1);
  });
  await t.test('first invalid student proof gets seven-day correction; expiry restores catalog price; second invalid suspends', async () => {
    const tenant = await workspace();
    await pool.query(`INSERT INTO subscriptions(tenant_id,plan_id,status,cycle,period_start,period_end,price_override_idr)
      VALUES($1,'pelajar','active','monthly',now(),now()+interval '20 days',19000)`, [tenant]);
    const renewal = await invoice(tenant, 'pelajar');
    await pool.query('UPDATE invoices SET amount_idr=19000 WHERE id=$1', [renewal.id]);
    const email = 'student@campus.example.ac.id';
    const decide = (id: string) => call(`/student-requests/${id}/decision`, { session: op, method: 'POST', key: randomUUID(),
      body: { decision: 'reject', reason: 'Bukti tidak valid', expected: { request_id: id, version: 1 } } });
    await requestStudentVerification(tenant, email, 'Keterangan bukti pertama');
    let id = (await pool.query("SELECT id FROM student_requests WHERE tenant_id=$1 AND status='pending'", [tenant])).rows[0].id as string;
    const first = await decide(id);
    assert.equal(first.status, 200, first.text); assert.equal(first.body.data.status, 'correction_required');
    const dueAt = (await pool.query('SELECT correction_due_at FROM student_requests WHERE id=$1', [id])).rows[0].correction_due_at as Date;
    assert.ok(dueAt.getTime() > Date.now() + 6 * 86_400_000 && dueAt.getTime() < Date.now() + 8 * 86_400_000);
    let sub = (await pool.query('SELECT status,price_override_idr FROM subscriptions WHERE tenant_id=$1', [tenant])).rows[0];
    assert.equal(sub.status, 'active'); assert.equal(sub.price_override_idr, 19000);
    assert.equal((await pool.query('SELECT kind FROM student_email_outbox WHERE student_request_id=$1', [id])).rows[0].kind, 'correction_deadline');
    await pool.query("UPDATE student_requests SET correction_due_at=now()-interval '1 second' WHERE id=$1", [id]);
    assert.equal(await sweepStudentVerificationDeadlines(), 1);
    sub = (await pool.query('SELECT status,price_override_idr FROM subscriptions WHERE tenant_id=$1', [tenant])).rows[0];
    assert.equal(sub.status, 'active'); assert.equal(sub.price_override_idr, null);
    assert.equal((await pool.query('SELECT amount_idr FROM invoices WHERE id=$1', [renewal.id])).rows[0].amount_idr, 29000,
      'an already-created unpaid renewal is repriced at the catalog rate at the deadline');
    assert.equal((await pool.query('SELECT status FROM student_requests WHERE id=$1', [id])).rows[0].status, 'expired');
    await requestStudentVerification(tenant, email, 'Keterangan bukti kedua');
    id = (await pool.query("SELECT id FROM student_requests WHERE tenant_id=$1 AND status='pending'", [tenant])).rows[0].id as string;
    const second = await decide(id);
    assert.equal(second.status, 200, second.text); assert.equal(second.body.data.status, 'rejected');
    sub = (await pool.query('SELECT status,price_override_idr FROM subscriptions WHERE tenant_id=$1', [tenant])).rows[0];
    assert.equal(sub.status, 'suspended'); assert.equal(sub.price_override_idr, null);
    assert.equal((await pool.query('SELECT kind FROM student_email_outbox WHERE student_request_id=$1', [id])).rows[0].kind, 'second_invalid_suspend');
  });

  await t.test('workspace and invoice DTOs omit all seeded secrets; pagination remains stable beyond end', async () => {
    const i=await invoice();
    await pool.query('INSERT INTO devices(tenant_id,device_key,qr_code) VALUES ($1,$2,$3)',[i.tenantId,`SYNTH-${randomUUID().slice(0,10)}`,'PRIVATE_QR']);
    for(const route of [`/invoices/${i.id}`,`/workspaces/${i.tenantId}`,'/workspaces?limit=1','/invoices?limit=1']) {
      const result=await call(route,{session:op}); assert.equal(result.status,200,result.text);
      for(const secret of ['api_key','webhook_secret','password_hash','qr_code','PRIVATE_QR','secret-key-','secret-hook-']) assert.ok(!result.text.includes(secret),secret);
    }
    const page=await call('/invoices?limit=1&offset=999',{session:op}); assert.deepEqual(page.body.data,[]);
    assert.ok(page.body.pagination.total>0); assert.equal(page.body.pagination.has_more,false);
  });

  await t.test('owner insights require owner:insights, return aggregate/read-only data, and audit every successful view', async () => {
    const denied = await operator(['payments:read']);
    const before = Number((await pool.query("SELECT count(*)::int AS n FROM operator_audit WHERE action='owner.insights.view'")).rows[0]!.n);
    assert.equal((await call('/insights', { session: denied })).status, 403, 'staff without the owner permission cannot load insights');
    assert.equal(Number((await pool.query("SELECT count(*)::int AS n FROM operator_audit WHERE action='owner.insights.view'")).rows[0]!.n), before, 'denied access does not create a successful-view audit row');

    const owner = phaseAOwner;
    const ownerRow = await pool.query<{ permissions: string[]; is_owner: boolean }>('SELECT permissions, is_owner FROM operators WHERE id=$1', [owner.id]);
    assert.deepEqual(new Set(ownerRow.rows[0]?.permissions), new Set(ownerPermissions), 'owner receives the full operational set plus insights');
    assert.equal(ownerRow.rows[0]?.is_owner, true);
    await assert.rejects(
      pool.query(
        'INSERT INTO operators(email,name,password_hash,permissions) VALUES ($1,$2,$3,$4)',
        [`staff-${randomUUID()}@example.test`, 'Staf Uji', passwordHash, ownerPermissions],
      ),
      (error: unknown) => (error as { code?: string }).code === '23514',
      'database policy prevents granting owner:insights to non-owner operators',
    );
    await assert.rejects(
      pool.query('UPDATE operators SET permissions=$1 WHERE id=$2', [ownerPermissions, denied.id]),
      (error: unknown) => (error as { code?: string }).code === '23514',
      'staff cannot acquire owner:insights via permission update',
    );
    const response = await call('/insights', { session: owner });
    assert.equal(response.status, 200);
    assert.ok(response.body.data.kpis.registered_accounts >= 1);
    assert.ok(response.body.data.kpis.active_workspaces >= 1);
    assert.ok(response.body.data.health.queue.queued >= 0);
    assert.ok(Array.isArray(response.body.data.activity));
    assert.ok(Array.isArray(response.body.data.data_limits));
    const encoded = JSON.stringify(response.body.data);
    for (const forbidden of ['password_hash', 'api_key', 'webhook_secret', 'to_number', 'content', 'phone_number']) assert.equal(encoded.includes(forbidden), false, `response omits ${forbidden}`);
    const audited = await pool.query("SELECT operator_id, target_type, target_label, host(client_ip) AS client_ip FROM operator_audit WHERE action='owner.insights.view' ORDER BY at DESC LIMIT 1");
    assert.equal(audited.rows[0]?.operator_id, owner.id);
    assert.equal(audited.rows[0]?.target_type, 'system_insights');
    assert.equal(audited.rows[0]?.target_label, 'Ringkasan Pemilik');
    assert.ok(audited.rows[0]?.client_ip, 'owner section access stores the request IP');
    const ownerAudit = await call(`/audit?from=${encodeURIComponent(new Date(Date.now()-60_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now()+60_000).toISOString())}&action=owner.insights.view`, { session: owner });
    assert.equal(ownerAudit.status, 200);
    assert.equal(ownerAudit.body.data[0]?.client_ip, audited.rows[0]?.client_ip, 'owner can inspect the source IP on the owner section audit row');
    const staff = await operator(['audit:read']);
    const staffAudit = await call(`/audit?from=${encodeURIComponent(new Date(Date.now()-60_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now()+60_000).toISOString())}&action=owner.insights.view`, { session: staff });
    assert.equal(staffAudit.status, 200);
    assert.equal(staffAudit.body.data[0]?.client_ip, null, 'staff audit permission does not expose owner source IP');
  });
  await t.test('break-glass login requires a delivered owner alert, has audit:read only, and refreshes the 90-day validation clock', async () => {
    const directory = await fs.mkdtemp(path.join(process.env['TMPDIR'] ?? '/tmp', 'koneva-break-glass-test-'));
    const outbox = path.join(directory, 'outbox.jsonl');
    const previous = { transport: process.env['EMAIL_TRANSPORT'], outbox: process.env['DEV_EMAIL_OUTBOX_FILE'], recipient: process.env['OPERATOR_BREAK_GLASS_ALERT_EMAIL'] };
    process.env['EMAIL_TRANSPORT'] = 'dev-outbox';
    process.env['DEV_EMAIL_OUTBOX_FILE'] = outbox;
    process.env['OPERATOR_BREAK_GLASS_ALERT_EMAIL'] = 'owner@example.test';
    try {
      const id = randomUUID(), email = `${id}@example.test`;
      await pool.query("INSERT INTO operators(id,email,name,password_hash,permissions,is_break_glass) VALUES ($1,$2,'Operator Darurat',$3,$4,true)",
        [id, email, passwordHash, ['audit:read']]);
      const result = await call('/auth/login', { method: 'POST', body: { email, password: testPassword } });
      assert.equal(result.status, 200, result.text);
      assert.equal(result.body.data.status, 'authenticated');
      assert.deepEqual(result.body.data.permissions, ['audit:read']);
      const notification = await fs.readFile(outbox, 'utf8');
      assert.equal(notification.split('\n').filter(Boolean).length, 1);
      assert.match(notification, /owner@example\.test/);
      assert.match(notification, /akun Operator darurat digunakan/);
      const state = (await pool.query<{ break_glass_validated_at: Date | null; event_count: number }>(
        `SELECT o.break_glass_validated_at,
          (SELECT count(*)::int FROM operator_security_events WHERE operator_id=o.id AND event='break_glass_login') AS event_count
         FROM operators o WHERE o.id=$1`, [id])).rows[0]!;
      assert.ok(state.break_glass_validated_at);
      assert.equal(state.event_count, 1);
    } finally {
      if (previous.transport === undefined) delete process.env['EMAIL_TRANSPORT']; else process.env['EMAIL_TRANSPORT'] = previous.transport;
      if (previous.outbox === undefined) delete process.env['DEV_EMAIL_OUTBOX_FILE']; else process.env['DEV_EMAIL_OUTBOX_FILE'] = previous.outbox;
      if (previous.recipient === undefined) delete process.env['OPERATOR_BREAK_GLASS_ALERT_EMAIL']; else process.env['OPERATOR_BREAK_GLASS_ALERT_EMAIL'] = previous.recipient;
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
  await t.test('legacy admin lists omit credentials and never accept operator cookies as admin credentials', async () => {
    const root=base.replace(/\/operator$/,'');
    const denied=await fetch(root+'/admin/tenants',{headers:{Cookie:op.cookie}});
    assert.equal(denied.status,401);
    for(const route of ['/admin/tenants','/admin/devices','/admin/devices?status=offline']) {
      const result=await fetch(root+route,{headers:{'x-admin-key':'operator-test-admin'}});
      assert.equal(result.status,200); const text=await result.text();
      for(const secret of ['api_key','webhook_secret','qr_code','PRIVATE_QR','secret-key-','secret-hook-']) assert.ok(!text.includes(secret),secret);
    }
  });
  await t.test('idle renewal is throttled, capped by absolute expiry, and cannot resurrect revoked sessions', async () => {
    const account=await operator();
    await pool.query("UPDATE operator_sessions SET touched_at=now()-interval '2 minutes',idle_expires_at=now()+interval '1 minute',absolute_expires_at=now()+interval '10 minutes' WHERE token_hash=$1",[hash(account.token)]);
    const first=await call('/me',{session:account}); assert.equal(first.status,200);
    assert.equal(first.body.data.session.idle_expires_at,first.body.data.session.absolute_expires_at);
    const second=await call('/me',{session:account}); assert.deepEqual(second.body.data.session,first.body.data.session);
    await pool.query('UPDATE operator_sessions SET revoked_at=now() WHERE token_hash=$1',[hash(account.token)]);
    assertCode(await call('/me',{session:account}),401,'SESSION_EXPIRED');
  });
  await t.test('audit uses UTC inclusive start/exclusive end, preserving WIB day boundaries', async () => {
    const target=randomUUID();
    for(const at of ['2026-09-25T16:59:59Z','2026-09-25T17:00:00Z','2026-09-26T16:59:59Z','2026-09-26T17:00:00Z']) {
      await pool.query(`INSERT INTO operator_audit(at,operator_id,action,target_type,target_id,changes,request_id) VALUES ($1,$2,'test.boundary','invoice',$3,'{}',$4)`,[at,op.id,target,randomUUID()]);
    }
    const result=await call(`/audit?from=2026-09-25T17:00:00Z&to=2026-09-26T17:00:00Z&target_id=${target}`,{session:op});
    assert.equal(result.status,200,result.text); assert.equal(result.body.pagination.total,2);
    assert.deepEqual(result.body.data.map((row:{at:string})=>row.at),['2026-09-26T16:59:59.000Z','2026-09-25T17:00:00.000Z']);
    assertCode(await call('/audit?from=2026-01-01T00:00:00Z&to=2026-09-26T00:00:00Z',{session:op}),400,'VALIDATION_ERROR');
    await assert.rejects(pool.query('DELETE FROM operator_audit WHERE target_id=$1',[target]),/append only/);
  });
  await t.test('idle/absolute expiry, account disablement and password changes revoke operator access', async () => {
    for(const column of ['idle_expires_at','absolute_expires_at']) {
      const account=await operator(); await pool.query(`UPDATE operator_sessions SET ${column}=now()-interval '1 second' WHERE token_hash=$1`,[hash(account.token)]);
      assertCode(await call('/me',{session:account}),401,'SESSION_EXPIRED');
    }
    for(const mutation of ["disabled_at=now()","password_hash='changed-hash'"]) {
      const account=await operator();await pool.query(`UPDATE operators SET ${mutation} WHERE id=$1`,[account.id]);
      assertCode(await call('/me',{session:account}),401,'SESSION_EXPIRED');
      assert.ok((await pool.query('SELECT revoked_at FROM operator_sessions WHERE token_hash=$1',[hash(account.token)])).rows[0].revoked_at);
    }
    const account=await operator();
    assert.equal((await call('/auth/sessions/revoke-all',{session:account,method:'POST'})).status,204);
    assertCode(await call('/me',{session:account}),401,'SESSION_EXPIRED');
  });
  await t.test('login attempts persistently lock unknown identities with Retry-After and generic errors', async () => {
    const email=`absent-${randomUUID()}@example.test`;
    for(let n=0;n<5;n++) assertCode(await call('/auth/login',{method:'POST',body:{email,password:'synthetic-wrong'}}),401,'INVALID_CREDENTIALS');
    const limited=await call('/auth/login',{method:'POST',body:{email,password:'synthetic-wrong'}});
    assertCode(limited,429,'RATE_LIMITED');assert.ok(Number(limited.headers.get('retry-after'))>0);
  });
  await t.test('MFA endpoints return 410 Gone', async () => {
    for (const route of ['/auth/mfa/verify', '/auth/mfa/enroll/start', '/auth/mfa/enroll/confirm']) {
      const result = await call(route, { session: op, method: 'POST', body: {} });
      assert.equal(result.status, 410, `${route}: ${result.text}`);
      assert.equal(result.body.error.code, 'MFA_REMOVED');
    }
  });

  // ---- Phase A: Owner Panel Extensions acceptance tests ----
  await t.test('Phase A: device list supports status filter and paginates', async () => {
    const owner = phaseAOwner;
    const ws = await workspace();
    const deviceId = randomUUID();
    await pool.query(`INSERT INTO devices(id,tenant_id,device_key,label,status,phone_number) VALUES ($1,$2,$3,'Device Uji','online','6281234567890')`, [deviceId, ws, `TEST-${deviceId.slice(0, 20)}`]);
    const attentionId = randomUUID();
    await pool.query(`INSERT INTO devices(id,tenant_id,device_key,label,status) VALUES ($1,$2,$3,'Device Perhatian','error')`, [attentionId, ws, `TEST-${attentionId.slice(0, 20)}`]);
    const all = await call('/insights/devices?limit=10&offset=0', { session: owner });
    assert.equal(all.status, 200);
    assert.ok(Array.isArray(all.body.data));
    assert.ok(all.body.pagination.total >= 1);
    const device = all.body.data.find((d: Record<string, unknown>) => d['id'] === deviceId);
    assert.ok(device, 'inserted device appears in list');
    assert.equal(device.status, 'online');
    assert.equal(device.status_label, 'Online');
    assert.ok(device.phone_masked?.startsWith('****'), 'phone is masked server-side');
    assert.ok(device.workspace?.name);
    const filtered = await call('/insights/devices?status=offline&limit=10&offset=0', { session: owner });
    assert.equal(filtered.status, 200);
    for (const d of filtered.body.data) assert.equal(d.status, 'offline', 'status filter works');
    const attention = await call('/insights/devices?attention=1&limit=50&offset=0', { session: owner });
    assert.equal(attention.status, 200);
    assert.ok(attention.body.data.some((d: Record<string, unknown>) => d['id'] === attentionId), 'attention filter includes an error-state device');
    const auditRow = await pool.query("SELECT 1 FROM operator_audit WHERE action='owner.device_monitor.view' AND operator_id=$1", [owner.id]);
    assert.ok(auditRow.rowCount! >= 1, 'device list view is audited');
  });

  await t.test('Phase A: device detail uses 24h fail ratio and audits', async () => {
    const owner = phaseAOwner;
    const ws = await workspace();
    const deviceId = randomUUID();
    await pool.query(`INSERT INTO devices(id,tenant_id,device_key,label,status,phone_number) VALUES ($1,$2,$3,'Device Detail','online','6281234560000')`, [deviceId, ws, `TEST-${deviceId.slice(0, 20)}`]);
    const detail = await call(`/insights/devices/${deviceId}`, { session: owner });
    assert.equal(detail.status, 200);
    const d = detail.body.data;
    assert.equal(d.id, deviceId);
    assert.equal(d.status, 'online');
    assert.ok('reconnect_24h' in d);
    assert.ok('stream_error_24h' in d);
    assert.ok('fail_ratio' in d);
    assert.ok('thresholds' in d);
    assert.ok(Array.isArray(d.events));
    assert.equal(d.container_status, 'unavailable');
    const encoded = JSON.stringify(d);
    for (const forbidden of ['password_hash', 'api_key', 'webhook_secret', 'content']) assert.equal(encoded.includes(forbidden), false, `device detail omits ${forbidden}`);
    const auditRow = await pool.query("SELECT 1 FROM operator_audit WHERE action='owner.device_detail.view' AND operator_id=$1", [owner.id]);
    assert.ok(auditRow.rowCount! >= 1, 'device detail view is audited');
  });

  await t.test('Phase A: system health returns 1h error rate, api/db status, email transport', async () => {
    const owner = phaseAOwner;
    const health = await call('/insights/health', { session: owner });
    assert.equal(health.status, 200);
    const h = health.body.data;
    assert.ok(h.measured_at);
    assert.equal(h.api_status, 'responding');
    assert.equal(h.db_status, 'connected');
    assert.ok('error_rate_1h' in h, 'has 1h error rate');
    assert.ok('error_rate_24h' in h, 'has 24h error rate');
    assert.ok(typeof h.error_rate_1h.percent === 'number');
    assert.ok(h.email_transport && h.email_transport !== 'unavailable', 'email transport shows config mode');
    assert.ok(h.queue);
    assert.ok(h.otp);
    assert.ok(h.thresholds);
    assert.ok(h.threshold_devices);
    const auditRow = await pool.query("SELECT 1 FROM operator_audit WHERE action='owner.system_health.view' AND operator_id=$1", [owner.id]);
    assert.ok(auditRow.rowCount! >= 1, 'system health view is audited');
  });

  await t.test('Phase A: workspace list supports email search, plan/status filter', async () => {
    const owner = phaseAOwner;
    const all = await call('/insights/workspaces?limit=10&offset=0', { session: owner });
    assert.equal(all.status, 200);
    assert.ok(Array.isArray(all.body.data));
    assert.ok(all.body.pagination.total >= 1);
    const item = all.body.data[0];
    assert.ok('name' in item);
    assert.ok('status' in item);
    assert.ok('device_count' in item);
    assert.ok('member_count' in item);
    assert.ok('messages_30d' in item);
    const byStatus = await call('/insights/workspaces?status=active&limit=10&offset=0', { session: owner });
    assert.equal(byStatus.status, 200);
    for (const w of byStatus.body.data) assert.equal(w.status, 'active', 'status filter works');
    const byEmail = await call(`/insights/workspaces?q=example.test&limit=10&offset=0`, { session: owner });
    assert.equal(byEmail.status, 200, 'email search succeeds');
    const auditRow = await pool.query("SELECT 1 FROM operator_audit WHERE action='owner.workspace_list.view' AND operator_id=$1", [owner.id]);
    assert.ok(auditRow.rowCount! >= 1, 'workspace list view is audited');
  });

  await t.test('Phase A: workspace detail includes members, payments, used_messages', async () => {
    const owner = phaseAOwner;
    const ws = await workspace();
    const detail = await call(`/insights/workspaces/${ws}`, { session: owner });
    assert.equal(detail.status, 200);
    const w = detail.body.data;
    assert.equal(w.id, ws);
    assert.ok('used_messages' in w, 'returns used_messages');
    assert.ok(typeof w.used_messages === 'number');
    assert.ok(Array.isArray(w.members), 'returns members array');
    assert.ok(w.members.length >= 1, 'workspace has at least the owner member');
    assert.ok(w.members[0].name);
    assert.ok(w.members[0].email);
    assert.ok(w.members[0].role);
    assert.ok(Array.isArray(w.recent_payments), 'returns recent_payments array');
    assert.ok(Array.isArray(w.devices));
    assert.ok('quota_messages' in w);
    assert.ok('max_devices' in w);
    const encoded = JSON.stringify(w);
    for (const forbidden of ['password_hash', 'api_key', 'webhook_secret', 'content']) assert.equal(encoded.includes(forbidden), false, `workspace detail omits ${forbidden}`);
    const auditRow = await pool.query("SELECT 1 FROM operator_audit WHERE action='owner.workspace_detail.view' AND operator_id=$1", [owner.id]);
    assert.ok(auditRow.rowCount! >= 1, 'workspace detail view is audited');
  });

  await t.test('Phase A: owner insights includes device_counts', async () => {
    const owner = phaseAOwner;
    const response = await call('/insights', { session: owner });
    assert.equal(response.status, 200);
    const d = response.body.data;
    assert.ok(d.device_counts, 'response includes device_counts');
    assert.ok(typeof d.device_counts.total === 'number');
    assert.ok(typeof d.device_counts.online === 'number');
    assert.ok(typeof d.device_counts.offline === 'number');
    assert.ok(typeof d.device_counts.attention === 'number');
  });

  await t.test('Phase A: staff without owner:insights is denied on all Phase A endpoints', async () => {
    const staff = await operator(['payments:read']);
    for (const route of ['/insights/devices', '/insights/devices/' + randomUUID(), '/insights/health', '/insights/workspaces', '/insights/workspaces/' + randomUUID()]) {
      assertCode(await call(route, { session: staff }), 403, 'FORBIDDEN');
    }
  });
});
