// Integration fixture for the isolated personal stack. Never sends a message.
// Usage: node scripts/verify-personal.mjs seed|check|cleanup
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import Redis from 'ioredis';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = dotenv.parse(fs.readFileSync(process.env.PERSONAL_ENV_FILE || path.join(root, '.env.personal')));
const base = `http://127.0.0.1:${env.API_PORT || 18000}`;
const stateFile = path.join(root, 'data/personal/infrastructure-smoke.json');
const db = new pg.Pool({ host: '127.0.0.1', port: Number(env.DB_PORT || 55432),
  user: env.DB_USER || 'wagateway', database: env.DB_NAME || 'wagateway', password: env.DB_PASSWORD });
const redis = new Redis({ host: '127.0.0.1', port: Number(env.REDIS_PORT || 56379), password: env.REDIS_PASSWORD });
let state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
async function api(endpoint, body, method = body ? 'POST' : 'GET', admin = false) {
  const response = await fetch(base + endpoint, { method,
    headers: { 'content-type': 'application/json', ...(admin ? { 'x-admin-key': env.ADMIN_API_KEY } : { apikey: state.api_key }) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
  assert.ok(response.ok, `${method} ${endpoint}: ${response.status}`);
  return response.json();
}
try {
  const mode = process.argv[2];
  if (mode === 'seed') {
    assert.ok(!state.tenant_id, 'Existing fixture; check or cleanup first');
    const tenant = await api('/admin/tenant/create', { name: 'Infrastructure smoke fixture', email: `smoke-${randomUUID()}@example.invalid` }, 'POST', true);
    state = { tenant_id: tenant.data.id, api_key: tenant.data.api_key, marker: randomUUID() };
    save();
    const contact = await api('/api/v1/contacts', { phone_number: '6280000000001', name: 'Persistence fixture' });
    state.contact_id = contact.data.id;
    save();
    const device = await api('/api/v1/devices', { label: 'Infrastructure smoke (unpaired)' });
    state.device_key = device.data.device_key;
    save();
    const session = path.join(env.SESSION_HOST_PATH || path.join(root, 'data/personal/sessions'), state.device_key);
    fs.writeFileSync(path.join(session, 'infrastructure-smoke.txt'), state.marker, { mode: 0o600 });
    await redis.set(`personal-smoke:${state.tenant_id}`, state.marker);
    console.log('Seeded temporary tenant, contact, unpaired bot, Redis key and session marker. No WhatsApp message sent.');
  } else if (mode === 'check') {
    assert.ok(state.tenant_id, 'No fixture');
    const contact = await api(`/api/v1/contacts/${state.contact_id}`);
    assert.equal(contact.data.name, 'Persistence fixture');
    assert.equal(await redis.get(`personal-smoke:${state.tenant_id}`), state.marker);
    const marker = path.join(env.SESSION_HOST_PATH || path.join(root, 'data/personal/sessions'), state.device_key, 'infrastructure-smoke.txt');
    assert.equal(fs.readFileSync(marker, 'utf8'), state.marker);
    const dashboard = await fetch(`http://127.0.0.1:${env.DASHBOARD_PORT || 13000}/api/v1/tenant`, {
      headers: { apikey: state.api_key }, signal: AbortSignal.timeout(15_000),
    });
    assert.equal(dashboard.status, 200, 'Same-origin tenant API proxy');
    const status = await api(`/api/v1/devices/${state.device_key}/qr`);
    assert.ok(status.status);
    console.log('PASS: PostgreSQL, Redis, session persistence, tenant API and dashboard API proxy.');
  } else if (mode === 'cleanup') {
    assert.ok(state.tenant_id, 'No fixture');
    if (state.device_key) await api(`/api/v1/devices/${state.device_key}`, undefined, 'DELETE');
    await db.query('DELETE FROM webhook_logs WHERE tenant_id=$1', [state.tenant_id]);
    await db.query('DELETE FROM messages WHERE tenant_id=$1', [state.tenant_id]);
    await db.query('DELETE FROM tenants WHERE id=$1 AND name=$2', [state.tenant_id, 'Infrastructure smoke fixture']);
    await redis.del(`personal-smoke:${state.tenant_id}`);
    fs.unlinkSync(stateFile);
    console.log('Removed only the recorded smoke fixture tenant, its contact/bot/session and Redis key.');
  } else throw new Error('Use seed|check|cleanup');
} finally {
  await redis.quit();
  await db.end();
}
