import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { Request, Response } from 'express';
import pool from '../../shared/database/connection';
import { assertRecipientConsent, normalizeRecipientNumber, recordManualContactConsent } from './recipient-consent.service';
import { ServiceError } from './service-error';
import { queueMessage, retryMessage } from './message.service';
import { setContactConsent } from '../routes/contact.routes';

type Query = (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
const database = pool as unknown as { query: Query; connect: () => Promise<unknown> };
const originalQuery = database.query;
const originalConnect = database.connect;
afterEach(() => { database.query = originalQuery; database.connect = originalConnect; });

const code = (wanted: string) => (error: unknown) => error instanceof ServiceError && error.code === wanted;

test('recipient normalization treats an optional plus sign as the same workspace phone key', () => {
  assert.equal(normalizeRecipientNumber('+6281234567890'), '6281234567890');
  assert.equal(normalizeRecipientNumber('62 812-3456-7890'), '6281234567890');
});

test('API consent admission is tenant-scoped and accepts only an explicit opt-in', async () => {
  let sql = '';
  let values: unknown[] | undefined;
  const db = { query: async (text: string, args?: unknown[]) => { sql = text; values = args; return { rows: [{ status: 'opted_in' }] }; } };
  await assert.doesNotReject(() => assertRecipientConsent(db, 'tenant-a', '+6281234567890'));
  assert.match(sql, /tenant_id = \$1 AND phone_number = \$2/);
  assert.deepEqual(values, ['tenant-a', '6281234567890']);

  await assert.rejects(() => assertRecipientConsent({ query: async () => ({ rows: [] }) }, 'tenant-a', '6281234567890'), code('RECIPIENT_CONSENT_REQUIRED'));
  await assert.rejects(() => assertRecipientConsent({ query: async () => ({ rows: [{ status: 'opted_out' }] }) }, 'tenant-a', '6281234567890'), code('RECIPIENT_OPTED_OUT'));
});

test('only a server-verified transaction may skip the consent lookup', async () => {
  let queries = 0;
  const db = { query: async () => { queries += 1; return { rows: [] }; } };
  await assert.doesNotReject(() => assertRecipientConsent(db, 'tenant-a', '6281234567890', true));
  assert.equal(queries, 0);
});

test('manual contact consent requires a signed-in workspace member, evidence note, and an audit event', async () => {
  const statements: Array<{ text: string; values?: unknown[] }> = [];
  database.connect = async () => ({
    query: async (text: string, values?: unknown[]) => {
      statements.push({ text, ...(values === undefined ? {} : { values }) });
      if (text.startsWith('SELECT regexp_replace')) return { rows: [{ phone_number: '6281234567890' }] };
      if (text.includes('INSERT INTO recipient_preferences')) return { rows: [{ tenant_id: 'tenant-a', phone_number: '6281234567890', status: 'opted_in' }] };
      return { rows: [] };
    },
    release() {},
  });

  const recorded = await recordManualContactConsent('tenant-a', 'contact-a', 'opted_in', ' offline store form ', 'user-a');
  assert.equal(recorded.status, 'opted_in');
  assert.equal(statements[2]?.values?.[3], 'offline store form');
  assert.match(statements[3]?.text ?? '', /INSERT INTO recipient_consent_events/);
  assert.deepEqual(statements.at(-1)?.text, 'COMMIT');

  await assert.rejects(() => recordManualContactConsent('tenant-a', 'contact-a', 'opted_in', '   ', 'user-a'), code('CONSENT_SOURCE_REQUIRED'));
});

test('an API key cannot self-assert manual opt-in', async () => {
  const request = {
    tenant: { id: 'tenant-a' }, actor: { kind: 'api_key', role: 'admin' },
    validated: { params: { id: 'contact-id' }, body: { status: 'opted_in', source_note: 'form' } },
  } as unknown as Request;
  await assert.rejects(() => setContactConsent(request, {} as Response), code('CONSENT_ACTOR_REQUIRED'));
});

test('caller priority urgent cannot skip API admission or create a queue record without consent', async () => {
  const statements: string[] = [];
  database.connect = async () => ({
    query: async (text: string) => {
      statements.push(text);
      if (text.includes('FROM subscriptions')) return { rows: [] };
      if (text.includes('FROM recipient_preferences')) return { rows: [] };
      return { rows: [] };
    },
    release() {},
  });

  await assert.rejects(() => queueMessage('tenant-a', {
    device_key: 'device-a', to: '6281234567890', message: 'Diskon hari ini', priority: 'urgent',
  }), code('RECIPIENT_CONSENT_REQUIRED'));
  assert.equal(statements.some((text) => text.includes('INSERT INTO messages')), false);
});

test('retry is a fresh API admission and refuses an opted-out number before re-queueing', async () => {
  const statements: string[] = [];
  database.query = async (text: string) => {
    statements.push(text);
    if (text.includes('AS device_status')) return { rows: [{ device_status: 'online', to_number: '6281234567890', quota_exempt: false }] };
    if (text.includes('FROM recipient_preferences')) return { rows: [{ status: 'opted_out' }] };
    return { rows: [] };
  };
  await assert.rejects(() => retryMessage('tenant-a', '00000000-0000-0000-0000-000000000001'), code('RECIPIENT_OPTED_OUT'));
  assert.equal(statements.some((text) => text.startsWith('UPDATE messages')), false);
});
