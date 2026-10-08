import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { AuditWriteError, canonicalJson, operatorTransaction, OperatorError } from './operator/core';
import { readOperatorConfig } from './operator/config';

test('operator configuration fails closed and never weakens production cookies', () => {
  assert.equal(readOperatorConfig({}).enabled, false);
  for (const overrides of [
    { OPERATOR_INSECURE_DEV_COOKIES: 'true' }, { OPERATOR_COOKIE_SECURE: 'false' }, { OPERATOR_COOKIE_NAME: 'plain' }, { OPERATOR_ENABLED: 'true' },
  ]) assert.throws(() => readOperatorConfig({ NODE_ENV: 'production', ...overrides }));
  assert.throws(() => readOperatorConfig({ OPERATOR_ENABLED: 'true', OPERATOR_ALLOWED_ORIGIN: 'http://example.test' }));
  assert.throws(() => readOperatorConfig({ OPERATOR_ENABLED: 'true', OPERATOR_ALLOWED_ORIGIN: 'http://localhost:13000/' }));
  assert.throws(() => readOperatorConfig({ OPERATOR_ENABLED: 'true', OPERATOR_ALLOWED_ORIGIN: 'http://localhost:13000', OPERATOR_COOKIE_SECURE: 'false' }));
  assert.equal(readOperatorConfig({ OPERATOR_ENABLED: 'true', OPERATOR_ALLOWED_ORIGIN: 'http://localhost:13000', OPERATOR_COOKIE_NAME: 'koneva_op_dev', OPERATOR_COOKIE_SECURE: 'false', OPERATOR_INSECURE_DEV_COOKIES: 'true' }).secure, false);
});
test('payload hash canonicalization ignores key order but preserves actual payload changes', () => {
  assert.equal(canonicalJson({ a: 1, b: { x: 2, y: 'a' } }), canonicalJson({ b: { y: 'a', x: 2 }, a: 1 }));
  assert.notEqual(canonicalJson({ note: '' }), canonicalJson({}));
});
test('audit rollback is definite only when rollback succeeded before any commit attempt', async () => {
  for (const failure of ['audit', 'rollback', 'commit'] as const) {
    let destroyed = false;
    const db = { connect: async () => ({
      query: async (sql: string) => {
        if (sql === 'COMMIT' && failure === 'commit') throw new Error('connection lost after COMMIT');
        if (sql === 'ROLLBACK' && failure === 'rollback') throw new Error('connection lost during ROLLBACK');
        return { rows: [] };
      }, release: (broken: boolean) => { destroyed = broken; },
    }) } as unknown as Pool;
    await assert.rejects(operatorTransaction(db, async () => { if (failure !== 'commit') throw new AuditWriteError(); return {}; }), (error: unknown) => {
      assert.ok(error instanceof OperatorError);
      assert.equal(error.code, failure === 'audit' ? 'AUDIT_FAILED' : 'OUTCOME_UNKNOWN');
      assert.equal(error.details?.['rolled_back'], failure === 'audit' ? true : undefined);
      return true;
    });
    assert.equal(destroyed, failure !== 'audit');
  }
});
