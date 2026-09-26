import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeEqual, safeIncludes } from './secure-compare';

test('safeEqual matches only identical secrets', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual(undefined, 'abc'), false);
  assert.equal(safeEqual('', 'abc'), false);
});

test('safeIncludes accepts any configured key (rotation) and rejects others', () => {
  assert.equal(safeIncludes('new', ['old', 'new']), true);
  assert.equal(safeIncludes('nope', ['old', 'new']), false);
  assert.equal(safeIncludes('x', []), false);
});
