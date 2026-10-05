// lib/portfolio-data/recommendationHysteresis.ts

// TAKEPROFIT-BASIS-0001 (Ian): with the page refreshing every 2 minutes, a position sitting near a threshold must not flip
// between recommendations on every refresh. A change is shown only when the new recommendation appears on two consecutive
// refreshes. Exceptions, so a risk alert is never delayed: a change TO an urgent recommendation (cut losses, assignment
// risk, earnings risk, verify pricing) shows at once. Leaving an urgent recommendation still needs the second refresh, so a
// single favourable tick cannot clear an alert. A first load (no previous result) shows the result as computed.

import type { PortfolioRecommendation } from '@/lib/portfolio-intelligence/objectives/positionObjective';
import type { PortfolioObjective } from '@/lib/portfolio-intelligence/types';

export const IMMEDIATE_RECOMMENDATION_KINDS: ReadonlySet<string> = new Set(['close-loser', 'assignment-risk', 'earnings-risk', 'verify-pricing']);

export interface RecommendationState {
  recommendation?: PortfolioRecommendation;
  portfolioObjective?: PortfolioObjective | null;
  recommendationPending?: { key: string; label: string } | null;
}

/** Identity of a recommendation for comparison: its kind plus the winning management intent. */
export function recommendationKey(rec: PortfolioRecommendation | undefined): string | null {
  if (!rec) return null;
  return `${rec.kind}|${rec.managementIntent?.intent ?? ''}`;
}

export function confirmRecommendationChange(previous: RecommendationState | undefined, next: RecommendationState): Required<RecommendationState> {
  const nextKey = recommendationKey(next.recommendation);
  const settled = { recommendation: next.recommendation as PortfolioRecommendation, portfolioObjective: next.portfolioObjective ?? null, recommendationPending: null };
  const prevKey = recommendationKey(previous?.recommendation);
  if (!previous || prevKey == null || nextKey == null || prevKey === nextKey) return settled;
  if (next.recommendation && IMMEDIATE_RECOMMENDATION_KINDS.has(next.recommendation.kind)) return settled;
  if (previous.recommendationPending?.key === nextKey) return settled;
  return {
    recommendation: previous.recommendation as PortfolioRecommendation,
    portfolioObjective: previous.portfolioObjective ?? null,
    recommendationPending: { key: nextKey, label: next.recommendation?.label ?? '' },
  };
}
