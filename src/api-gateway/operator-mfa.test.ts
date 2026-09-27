import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { base32Decode, base32Encode, codeHash, decryptSecret, encryptSecret, newEnrollmentCode, newRecoveryCodes, normalizeCode, otpauthUri, stepAt, totp, verifyTotp } from './operator/mfa';
import { readOperatorConfig } from './operator/config';

const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');

test('TOTP matches the RFC 6238 SHA-1 test vectors (6-digit tail of the published 8-digit codes)', () => {
  for (const [seconds, expected] of [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037']] as const) {
    assert.equal(totp(RFC_SECRET, stepAt(seconds * 1000)), expected, `T=${seconds}`);
  }
});

test('base32 round-trips and matches a known vector', () => {
  assert.equal(base32Encode(RFC_SECRET), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.deepEqual(base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'), RFC_SECRET);
  const random = randomBytes(20);
  assert.deepEqual(base32Decode(base32Encode(random)), random);
  assert.throws(() => base32Decode('not*base32'));
});

test('verification accepts one step of clock drift each way and nothing else', () => {
  const now = 1_700_000_000_000;
  const step = stepAt(now);
  for (const offset of [-1, 0, 1]) assert.equal(verifyTotp(RFC_SECRET, totp(RFC_SECRET, step + offset), now), step + offset);
  for (const offset of [-2, 2, 10]) assert.equal(verifyTotp(RFC_SECRET, totp(RFC_SECRET, step + offset), now), null);
  for (const bad of ['', '12345', '1234567', 'abcdef', '12345 ']) assert.equal(verifyTotp(RFC_SECRET, bad, now), null);
});

test('secrets are encrypted at rest, bound to the operator, and tamper-evident', () => {
  const key = randomBytes(32);
  const stored = encryptSecret(key, RFC_SECRET, 'op-1');
  assert.ok(!stored.includes(RFC_SECRET.toString('base64url')));
  assert.deepEqual(decryptSecret(key, stored, 'op-1'), RFC_SECRET);
  assert.throws(() => decryptSecret(key, stored, 'op-2'), 'another operator id must not decrypt it');
  assert.throws(() => decryptSecret(randomBytes(32), stored, 'op-1'));
  const parts = stored.split('.'); parts[3] = Buffer.from('tampered').toString('base64url');
  assert.throws(() => decryptSecret(key, parts.join('.'), 'op-1'));
  assert.notEqual(encryptSecret(key, RFC_SECRET, 'op-1'), stored, 'a fresh IV each time');
});

test('recovery and enrollment codes are typed forgivingly, hashed, and unique', () => {
  const codes = newRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const code of codes) assert.match(code, /^[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/);
  assert.match(newEnrollmentCode(), /^[2-9A-HJKMNP-Z]{5}(-[2-9A-HJKMNP-Z]{5}){2}$/);
  const code = codes[0]!;
  assert.equal(codeHash(code), codeHash(code.toLowerCase().replace('-', ' ')));
  assert.equal(normalizeCode(' ab-cd '), 'ABCD');
  assert.notEqual(codeHash(codes[0]!), codeHash(codes[1]!));
  assert.match(codeHash(code), /^[0-9a-f]{64}$/);
});

test('otpauth URI carries issuer, account and the standard parameters', () => {
  const uri = otpauthUri('ABCDEFGH', 'ops@example.test');
  assert.match(uri, /^otpauth:\/\/totp\/KONEVA%20Operator%3Aops%40example\.test\?secret=ABCDEFGH&issuer=KONEVA%20Operator&algorithm=SHA1&digits=6&period=30$/);
});

test('configuration: MFA key is mandatory when enabled, and production stays gated', () => {
  const key = randomBytes(32).toString('base64');
  const local = { OPERATOR_ENABLED: 'true', OPERATOR_ALLOWED_ORIGIN: 'http://localhost:13000', OPERATOR_COOKIE_NAME: 'koneva_op_dev', OPERATOR_COOKIE_SECURE: 'false', OPERATOR_INSECURE_DEV_COOKIES: 'true' };
  assert.throws(() => readOperatorConfig(local), /OPERATOR_MFA_ENC_KEY/);
  assert.throws(() => readOperatorConfig({ ...local, OPERATOR_MFA_ENC_KEY: 'short' }), /OPERATOR_MFA_ENC_KEY/);
  assert.throws(() => readOperatorConfig({ ...local, OPERATOR_MFA_ENC_KEY: randomBytes(16).toString('base64') }), /32/);
  assert.equal(readOperatorConfig({ ...local, OPERATOR_MFA_ENC_KEY: key }).mfaKey?.length, 32);
  assert.equal(readOperatorConfig({}).mfaKey, null, 'a disabled module needs no key');
  const production = { NODE_ENV: 'production', OPERATOR_ENABLED: 'true', OPERATOR_ALLOWED_ORIGIN: 'https://ops.example.test', OPERATOR_MFA_ENC_KEY: key };
  assert.throws(() => readOperatorConfig(production), /OPERATOR_ALLOW_PRODUCTION/);
  assert.throws(() => readOperatorConfig({ ...production, OPERATOR_ALLOW_PRODUCTION: 'true', OPERATOR_ALLOWED_ORIGIN: 'http://localhost:13000' }));
  assert.throws(() => readOperatorConfig({ ...production, OPERATOR_ALLOW_PRODUCTION: 'true', OPERATOR_INSECURE_DEV_COOKIES: 'true' }));
  assert.equal(readOperatorConfig({ ...production, OPERATOR_ALLOW_PRODUCTION: 'true' }).enabled, true);
});
