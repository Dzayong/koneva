export type PaygBillingCategory = 'api' | 'auto_reply' | 'ai_reply';

export interface PaygPricingTier {
  code: 'starter' | 'growth' | 'scale' | 'max';
  minSpentIdr: number;
  nextAtIdr: number | null;
  prices: Record<PaygBillingCategory, number>;
}

export const PAYG_PRICING_TIERS: readonly PaygPricingTier[] = [
  { code: 'starter', minSpentIdr: 0, nextAtIdr: 500_000, prices: { api: 15, auto_reply: 20, ai_reply: 50 } },
  { code: 'growth', minSpentIdr: 500_000, nextAtIdr: 1_300_000, prices: { api: 14, auto_reply: 19, ai_reply: 48 } },
  { code: 'scale', minSpentIdr: 1_300_000, nextAtIdr: 2_500_000, prices: { api: 13, auto_reply: 18, ai_reply: 46 } },
  { code: 'max', minSpentIdr: 2_500_000, nextAtIdr: null, prices: { api: 12, auto_reply: 17, ai_reply: 44 } },
] as const;

export function paygPricingTier(spentIdr: number): PaygPricingTier {
  if (!Number.isSafeInteger(spentIdr) || spentIdr < 0) throw new Error('Invalid cumulative PAYG usage');
  for (let index = PAYG_PRICING_TIERS.length - 1; index >= 0; index -= 1) {
    const tier = PAYG_PRICING_TIERS[index]!;
    if (spentIdr >= tier.minSpentIdr) return tier;
  }
  return PAYG_PRICING_TIERS[0]!;
}
