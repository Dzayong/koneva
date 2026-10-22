/** Auto-reply patterns run synchronously, so accept only a bounded simple subset. */
export function isSafeAutoReplyRegex(pattern: string): boolean {
  if (!pattern || pattern.length > 128) return false;
  let inCharacterClass = false;
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i]!;
    if (char === '\\') {
      const next = pattern[i + 1];
      if (next === undefined || /[1-9]|k/.test(next)) return false;
      i += 1;
      continue;
    }
    if (inCharacterClass) {
      if (char === ']') inCharacterClass = false;
      continue;
    }
    if (char === '[') { inCharacterClass = true; continue; }
    if (char === '(' || char === ')' || char === '|') return false;
  }
  if (inCharacterClass) return false;
  try { new RegExp(pattern, 'i'); return true; } catch { return false; }
}
