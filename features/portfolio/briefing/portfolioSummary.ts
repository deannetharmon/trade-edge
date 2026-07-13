// features/portfolio/briefing/portfolioSummary.ts
//
// PI-0004D: Portfolio Summary -- a short, natural-language readout for the
// Daily Portfolio Briefing. Every line is a presence/absence check against
// the `type` values Portfolio Intelligence already produced for this
// refresh -- no new condition is evaluated, no threshold re-checked. This
// deliberately mirrors the brief's own examples ("No concentration
// concerns.", "Buying power remains healthy.") rather than inventing new
// commentary.

import type { PortfolioObjective, PortfolioObjectiveType } from '@/lib/portfolio-intelligence';

const ALL_HEALTHY = 'Portfolio remains healthy.';

export function derivePortfolioSummary(objectives: PortfolioObjective[] | null): string[] {
  if (!objectives || objectives.length === 0) return [ALL_HEALTHY];

  const isWaitOnly = objectives.length === 1 && objectives[0].type === 'WAIT';
  if (isWaitOnly) return [ALL_HEALTHY];

  const types = new Set<PortfolioObjectiveType>(objectives.map((o) => o.type));
  const threatenedCount = objectives.filter((o) => o.type === 'REVIEW_THREATENED_POSITION').length;

  return [
    threatenedCount > 0
      ? `${threatenedCount} threatened position${threatenedCount !== 1 ? 's' : ''} need${threatenedCount === 1 ? 's' : ''} review.`
      : 'No threatened positions.',
    types.has('REDUCE_CONCENTRATION') ? 'Concentration above policy in one or more symbols.' : 'No concentration concerns.',
    types.has('PRESERVE_BUYING_POWER') ? 'Buying power utilization above policy.' : 'Buying power remains healthy.',
    types.has('INCREASE_INCOME') ? 'Income production below target.' : 'Income positions remain within policy.',
  ];
}
