import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProxyAgent, describeProxy } from './proxy';

test('no proxy configured yields no agent', () => {
  assert.equal(createProxyAgent(undefined), undefined);
});

test('socks and http proxies both produce an agent', () => {
  assert.ok(createProxyAgent('socks5://10.0.0.1:1080'));
  assert.ok(createProxyAgent('http://10.0.0.1:3128'));
});

test('unsupported protocols are rejected', () => {
  assert.throws(() => createProxyAgent('ftp://10.0.0.1:21'), /Unsupported/);
});

test('describeProxy never exposes credentials', () => {
  assert.equal(describeProxy('socks5://user:secret@10.0.0.1:1080'), 'socks5://10.0.0.1:1080');
});
