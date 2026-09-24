const SPAM_KEYWORDS = ['gratis', 'promo', 'diskon', 'click here', 'limited time'];
const URL_SHORTENERS = ['bit.ly', 'tiny.cc', 'goo.gl'];
const CAPS_RATIO_THRESHOLD = 0.5;
const SIMILARITY_THRESHOLD = 0.8;
const SPINTAX_PATTERN = /\{([^{}]+)\}/g;

export interface ContentFilterResult {
  allowed: boolean;
  reasons: string[];
}

function containsSpamKeyword(content: string): string | undefined {
  const lower = content.toLowerCase();
  return SPAM_KEYWORDS.find((keyword) => lower.includes(keyword));
}

function containsUrlShortener(content: string): string | undefined {
  const lower = content.toLowerCase();
  return URL_SHORTENERS.find((domain) => lower.includes(domain));
}

export function capsRatio(content: string): number {
  const letters = content.replace(/[^a-zA-Z]/g, '');
  if (letters.length === 0) {
    return 0;
  }
  const upper = letters.replace(/[^A-Z]/g, '');
  return upper.length / letters.length;
}

function tokenize(content: string): Set<string> {
  return new Set(
    content
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean),
  );
}

export function jaccardSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.size === 0 && tokensB.size === 0) {
    return 1;
  }

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      intersection += 1;
    }
  }

  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function findSimilarMessage(content: string, recentMessages: string[]): string | undefined {
  return recentMessages.find((prev) => jaccardSimilarity(content, prev) >= SIMILARITY_THRESHOLD);
}

export interface DetectSpamOptions {
  recentMessages?: string[] | undefined;
}

export function detectSpam(content: string, options: DetectSpamOptions = {}): ContentFilterResult {
  const reasons: string[] = [];

  const keyword = containsSpamKeyword(content);
  if (keyword) {
    reasons.push(`spam_keyword:${keyword}`);
  }

  const shortener = containsUrlShortener(content);
  if (shortener) {
    reasons.push(`url_shortener:${shortener}`);
  }

  const ratio = capsRatio(content);
  if (ratio > CAPS_RATIO_THRESHOLD) {
    reasons.push(`caps_ratio:${ratio.toFixed(2)}`);
  }

  const recentMessages = options.recentMessages ?? [];
  if (findSimilarMessage(content, recentMessages)) {
    reasons.push('similar_to_recent_message');
  }

  return { allowed: reasons.length === 0, reasons };
}

export interface PersonalizationContext {
  recipientName?: string | undefined;
}

export function hasPersonalization(content: string, context: PersonalizationContext): boolean {
  if (!context.recipientName) {
    return false;
  }
  return content.toLowerCase().includes(context.recipientName.toLowerCase());
}

export function renderSpintax(template: string, variables: Record<string, string> = {}): string {
  const lowerVars = new Map(Object.entries(variables).map(([key, value]) => [key.toLowerCase(), value]));

  return template.replace(SPINTAX_PATTERN, (match, inner: string) => {
    if (inner.includes('|')) {
      const options = inner.split('|').map((option) => option.trim());
      const choice = options[Math.floor(Math.random() * options.length)];
      return choice ?? match;
    }

    const value = lowerVars.get(inner.trim().toLowerCase());
    return value ?? match;
  });
}

export interface RecipientMessage {
  recipient: string;
  content: string;
}

export function isDuplicateAcrossRecipients(
  content: string,
  recipient: string,
  recentByRecipient: RecipientMessage[],
): boolean {
  return recentByRecipient.some(
    (entry) => entry.recipient !== recipient && entry.content.trim() === content.trim(),
  );
}

export interface EvaluateContentOptions {
  recipient: string;
  recipientName?: string | undefined;
  recentMessages?: string[] | undefined;
  recentByRecipient?: RecipientMessage[] | undefined;
  requirePersonalization?: boolean | undefined;
}

export function evaluateContent(content: string, options: EvaluateContentOptions): ContentFilterResult {
  const spam = detectSpam(content, { recentMessages: options.recentMessages });
  const reasons = [...spam.reasons];

  if (options.requirePersonalization && !hasPersonalization(content, { recipientName: options.recipientName })) {
    reasons.push('missing_personalization');
  }

  if (
    options.recentByRecipient &&
    isDuplicateAcrossRecipients(content, options.recipient, options.recentByRecipient)
  ) {
    reasons.push('duplicate_across_recipients');
  }

  return { allowed: reasons.length === 0, reasons };
}
