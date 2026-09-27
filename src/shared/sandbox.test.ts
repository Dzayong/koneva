import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSandbox, isSandboxEmailAllowed, normalizeEmail, sandboxEmailAllowlist, whatsappTransportMode } from './sandbox';

test('isSandbox is true only for the exact string "1"; unset/anything else is not sandbox (fail-closed default)', () => {
  assert.equal(isSandbox({}), false);
  assert.equal(isSandbox({ KONEVA_SANDBOX: '1' }), true);
  for (const value of ['true', 'yes', '0', ' 1', '1 ', 'TRUE']) assert.equal(isSandbox({ KONEVA_SANDBOX: value }), false, value);
});

test('whatsappTransportMode defaults to real when not sandbox, matching current :13000/production behaviour unchanged', () => {
  assert.equal(whatsappTransportMode({}), 'real');
  assert.equal(whatsappTransportMode({ WHATSAPP_TRANSPORT: 'real' }), 'real');
  assert.equal(whatsappTransportMode({ WHATSAPP_TRANSPORT: 'mock' }), 'mock');
});

test('whatsappTransportMode rejects an unknown value outside sandbox instead of silently defaulting', () => {
  assert.throws(() => whatsappTransportMode({ WHATSAPP_TRANSPORT: 'fake' }), /WHATSAPP_TRANSPORT/);
});

test('sandbox forces mock and cannot be overridden by WHATSAPP_TRANSPORT=real (no accidental way to turn it back on)', () => {
  assert.equal(whatsappTransportMode({ KONEVA_SANDBOX: '1' }), 'mock');
  assert.equal(whatsappTransportMode({ KONEVA_SANDBOX: '1', WHATSAPP_TRANSPORT: 'real' }), 'mock');
});

test('normalizeEmail trims and lower-cases', () => {
  assert.equal(normalizeEmail('  Owner@Example.COM  '), 'owner@example.com');
});

test('sandboxEmailAllowlist is empty by default (rejects everyone) and parses a comma-separated, normalized list', () => {
  assert.deepEqual([...sandboxEmailAllowlist({})], []);
  assert.deepEqual([...sandboxEmailAllowlist({ SANDBOX_EMAIL_ALLOWLIST: '' })], []);
  assert.deepEqual(
    [...sandboxEmailAllowlist({ SANDBOX_EMAIL_ALLOWLIST: ' Owner@Example.com , tester@example.com,,tester@example.com ' })].sort(),
    ['owner@example.com', 'tester@example.com'],
  );
});

test('isSandboxEmailAllowed is exact-match only after normalization; no substring/domain matching', () => {
  const env = { SANDBOX_EMAIL_ALLOWLIST: 'owner@example.com' };
  assert.equal(isSandboxEmailAllowed('Owner@Example.com', env), true);
  assert.equal(isSandboxEmailAllowed('owner@example.com.evil.test', env), false);
  assert.equal(isSandboxEmailAllowed('notowner@example.com', env), false);
  assert.equal(isSandboxEmailAllowed('owner@example.com', {}), false);
});
