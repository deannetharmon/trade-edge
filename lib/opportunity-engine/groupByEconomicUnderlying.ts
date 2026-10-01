import type { OpportunityRecommendation } from './types';

export interface EconomicUnderlyingOpportunityGroup {
  economicUnderlying: string;
  recommendations: OpportunityRecommendation[];
}

export function groupRecommendationsByEconomicUnderlying(
  recommendations: OpportunityRecommendation[],
): EconomicUnderlyingOpportunityGroup[] {
  const groups = new Map<string, OpportunityRecommendation[]>();
  for (const recommendation of recommendations) {
    const key = (recommendation.economicUnderlying ?? recommendation.symbol).toUpperCase();
    const existing = groups.get(key) ?? [];
    existing.push(recommendation);
    groups.set(key, existing);
  }
  return [...groups.entries()].map(([economicUnderlying, grouped]) => ({
    economicUnderlying,
    recommendations: grouped,
  }));
}
