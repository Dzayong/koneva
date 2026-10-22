import assert from 'node:assert/strict';
import test from 'node:test';
import { aiReplyCompletionsUrl, decryptAiReplySecret, encryptAiReplySecret, normalizeAiReplyBaseUrl } from './ai-reply-provider';

test('AI provider keys are authenticated-encrypted and endpoint paths preserve the provider base path', () => {
  const original = process.env['AI_REPLY_ENCRYPTION_KEY'];
  process.env['AI_REPLY_ENCRYPTION_KEY'] = Buffer.alloc(32, 7).toString('base64');
  try {
    const encrypted = encryptAiReplySecret('provider-secret');
    assert.notEqual(encrypted, 'provider-secret');
    assert.equal(decryptAiReplySecret(encrypted), 'provider-secret');
    assert.equal(aiReplyCompletionsUrl('https://provider.example/v1/'), 'https://provider.example/v1/chat/completions');
    assert.equal(normalizeAiReplyBaseUrl('http://localhost:8080/v1'), 'http://localhost:8080/v1');
    assert.throws(() => normalizeAiReplyBaseUrl('http://provider.example/v1'));
    const parts = encrypted.split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    assert.throws(() => decryptAiReplySecret(parts.join(':')));
  } finally {
    if (original === undefined) delete process.env['AI_REPLY_ENCRYPTION_KEY'];
    else process.env['AI_REPLY_ENCRYPTION_KEY'] = original;
  }
});
