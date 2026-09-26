import { createHash, timingSafeEqual } from 'node:crypto';

// Hashing first gives equal-length buffers, so neither content nor length of
// the secret leaks through comparison timing.
export function safeEqual(supplied: string | undefined, expected: string): boolean {
  if (!supplied) return false;
  const a = createHash('sha256').update(supplied).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export function safeIncludes(supplied: string | undefined, candidates: readonly string[]): boolean {
  let matched = false;
  for (const candidate of candidates) {
    if (safeEqual(supplied, candidate)) matched = true;
  }
  return matched;
}
