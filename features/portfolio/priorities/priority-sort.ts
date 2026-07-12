// features/portfolio/priorities/priority-sort.ts
//
// PI-0003: no longer used by priority-engine.ts, which now delegates
// ranking to the canonical prioritizePortfolioObjectives(). Left in place
// (not deleted) since it has no other consumers and isn't incorrect --
// just superseded. Candidate for physical removal in a later cleanup pass.

import type { PriorityItem } from './priority-types';
import type { PortfolioRecommendationUrgency } from '../recommendations/recommendation-types';

// Deterministic ordering weight for urgency. Higher = more urgent = sorts first.
const URGENCY_WEIGHT: Record<PortfolioRecommendationUrgency, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

// Comparator for priority items. Primary key is the composite score
// (descending). Ties are broken deterministically so the list is stable
// across renders: urgency weight, then symbol alphabetically, then
// positionId — no reliance on input order.
export function comparePriorityItems(
  a: Omit<PriorityItem, 'rank'>,
  b: Omit<PriorityItem, 'rank'>,
): number {
  if (b.score !== a.score) return b.score - a.score;

  const ua = URGENCY_WEIGHT[a.urgency] ?? 0;
  const ub = URGENCY_WEIGHT[b.urgency] ?? 0;
  if (ub !== ua) return ub - ua;

  if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol);

  return a.positionId.localeCompare(b.positionId);
}

// Sorts a list of scored (rank-less) priority items and assigns 1-based ranks.
export function sortAndRankPriorities(
  items: Omit<PriorityItem, 'rank'>[],
): PriorityItem[] {
  return [...items]
    .sort(comparePriorityItems)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}
