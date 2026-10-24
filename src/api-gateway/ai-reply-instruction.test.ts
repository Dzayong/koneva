import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAiReplySystemInstruction } from './operator/ai-reply-settings';

test('general AI replies use the safe generic support role without a custom prompt', () => {
  const instruction = buildAiReplySystemInstruction('ai_general', 'must not be used');
  assert.match(instruction, /asisten layanan pelanggan/);
  assert.match(instruction, /jangan mengarang harga/);
  assert.doesNotMatch(instruction, /must not be used/);
});

test('instructed AI replies apply one bounded role description', () => {
  const instruction = buildAiReplySystemInstruction('ai', 'Admin toko, jawab singkat dan sopan.');
  assert.match(instruction, /Admin toko, jawab singkat dan sopan/);
  assert.equal(buildAiReplySystemInstruction('ai', 'x'.repeat(4500)).length < 4200, true);
});
