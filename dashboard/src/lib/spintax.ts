// Mirrors src/bot-container/content-filter.ts's renderSpintax — kept as a
// separate, duplicated implementation on purpose: the dashboard only needs
// it for a live preview (no anti-ban decision depends on this copy being
// byte-identical), and importing across the dashboard/backend boundary
// isn't set up in this monorepo.

const SPINTAX_PATTERN = /\{([^{}]+)\}/g;

export function renderSpintax(template: string, variables: Record<string, string> = {}): string {
  const lowerVars = new Map(Object.entries(variables).map(([k, v]) => [k.toLowerCase(), v]));

  return template.replace(SPINTAX_PATTERN, (match, inner: string) => {
    if (inner.includes("|")) {
      const options = inner.split("|").map((o) => o.trim());
      const choice = options[Math.floor(Math.random() * options.length)];
      return choice ?? match;
    }
    const value = lowerVars.get(inner.trim().toLowerCase());
    return value ?? match;
  });
}

export function extractSpintaxVariables(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(SPINTAX_PATTERN)) {
    const inner = match[1] ?? "";
    if (!inner.includes("|")) {
      found.add(inner.trim());
    }
  }
  return Array.from(found);
}
