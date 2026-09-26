export type TemplateVariables = Record<string, string | number | null | undefined>;

export function templateVariables(content: string): string[] {
  const names = new Set<string>();
  for (const match of content.matchAll(/\{([^{}]+)\}/g)) {
    const expression = match[1]!.trim();
    if (!expression.includes('|') && expression.length > 0) names.add(expression);
  }
  return [...names];
}

export function renderMessageTemplate(
  content: string,
  variables: TemplateVariables = {},
  random: () => number = Math.random,
): string {
  const normalized = new Map(
    Object.entries(variables).map(([key, value]) => [key.toLocaleLowerCase(), value]),
  );
  return content.replace(/\{([^{}]+)\}/g, (original, raw: string) => {
    const expression = raw.trim();
    if (expression.includes('|')) {
      const choices = expression.split('|').map((choice) => choice.trim());
      return choices[Math.min(Math.floor(random() * choices.length), choices.length - 1)] ?? '';
    }
    const value = normalized.get(expression.toLocaleLowerCase());
    return value === undefined || value === null ? original : String(value);
  });
}
