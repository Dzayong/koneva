// STACK-local harness: the real operator router + real PostgreSQL migrations, without Redis, the bot or any WhatsApp code.
// Only for the disposable database created by scripts/test-operator-stack.sh. It is NOT src/api-gateway/index.ts.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import pool from '../src/shared/database/connection';
import { readOperatorConfig } from '../src/api-gateway/operator/config';
import { createOperatorRouter } from '../src/api-gateway/operator/router';
import http from 'node:http';
import { authorize, tenantAuth } from '../src/api-gateway/middleware/auth';
import { auditTrail } from '../src/api-gateway/middleware/audit';
import authRoutes from '../src/api-gateway/routes/auth.routes';
import billingRoutes from '../src/api-gateway/routes/billing.routes';
import publicRoutes from '../src/api-gateway/routes/public.routes';
import deviceRoutes from '../src/api-gateway/routes/device.routes';
import teamRoutes from '../src/api-gateway/routes/team.routes';
import { ServiceError } from '../src/api-gateway/services/service-error';

type Fault = 'drop' | 'html502' | 'redirect' | 'none';
const target = (process.env['STACK_FAULT_PATHS'] ?? 'confirm-payment,decision').split(',');

async function main(): Promise<void> {
  const url = new URL(process.env['DATABASE_URL'] ?? 'postgres://invalid');
  if (process.env['OPERATOR_STACK_HARNESS'] !== '1' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/operator_test') {
    throw new Error('Harness runs only against the disposable local database (OPERATOR_STACK_HARNESS=1, /operator_test on loopback).');
  }
  await pool.query('CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY)');
  const done = new Set((await pool.query<{ name: string }>('SELECT name FROM _migrations')).rows.map((r) => r.name));
  const dir = path.join(__dirname, '../migrations');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
      await client.query('INSERT INTO _migrations(name) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  // The per-IP router ceiling (120/min) is lifted here only because every test comes from one address; it has its own unit test.
  // Fault injection: applies to the NEXT matching mutation only, and only AFTER the handler committed, so the
  // browser sees a lost/garbled answer for an effect that really happened.
  let fault: Fault = 'none';
  let applied = 0;
  const app = express();
  app.set('trust proxy', 1);
  app.use((request, response, next) => {
    if (fault === 'none' || request.method !== 'POST' || !target.some((t) => request.path.endsWith(t))) { next(); return; }
    const mode = fault; fault = 'none'; applied += 1;
    response.json = ((_body: unknown) => {
      if (mode === 'drop') response.socket?.destroy();
      else if (mode === 'html502') response.status(502).type('html').send('<html><body>Bad Gateway</body></html>');
      else response.redirect(302, '/operator/login');
      return response;
    }) as typeof response.json;
    next();
  });
  // Customer surface for the roles/invitation browser tests: the real routers and middleware (sessions do not need Redis).
  app.use('/public', express.json(), publicRoutes); // marketing page pricing/info; no auth needed
  app.use('/auth', express.json(), authRoutes);
  app.use('/api/v1', express.json(), tenantAuth, authorize, auditTrail, deviceRoutes, teamRoutes, billingRoutes);
  app.use('/operator', createOperatorRouter(pool, { ...readOperatorConfig(), requestsPerMinute: 100_000 }));
  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) { next(error); return; }
    if (error instanceof ServiceError) { if (error.retryAfter) res.set('Retry-After', String(error.retryAfter)); res.status(error.status).json({ success: false, error: { code: error.code, message: error.message } }); return; }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });
  // Fake device manager (no container, no WhatsApp): records what the API asked of it.
  const managerCalls: string[] = [];
  const fakeManager = http.createServer((req, res) => { managerCalls.push(`${req.method} ${req.url}`); res.setHeader('content-type', 'application/json'); res.end('{"success":true}'); })
    .listen(Number(process.env['STACK_MANAGER_PORT'] ?? 18091), '127.0.0.1');
  const api = app.listen(Number(process.env['STACK_API_PORT'] ?? 13210), '127.0.0.1');

  const ctl = express();
  ctl.use(express.json());
  ctl.get('/health', (_q, r) => { r.json({ ok: true }); });
  ctl.post('/fault', (q, r) => { fault = (q.body as { mode: Fault }).mode; r.json({ fault }); });
  ctl.get('/manager-calls', (_q, r) => { r.json({ calls: managerCalls }); });
  // Switch the email transport at runtime (none = fail-safe default, dev-outbox = local file only).
  ctl.post('/email', (q, r) => { const mode = (q.body as { mode: string }).mode; if (mode === 'none') delete process.env['EMAIL_TRANSPORT']; else process.env['EMAIL_TRANSPORT'] = mode; r.json({ mode }); });
  ctl.get('/fault', (_q, r) => { r.json({ fault, applied }); });
  const control = ctl.listen(Number(process.env['STACK_CTL_PORT'] ?? 13211), '127.0.0.1');
  const stop = () => { api.close(); control.close(); fakeManager.close(); void pool.end().then(() => process.exit(0)); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  process.stdout.write('operator stack harness ready\n');
}
void main().catch((error) => { process.stderr.write(`harness failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exit(1); });
