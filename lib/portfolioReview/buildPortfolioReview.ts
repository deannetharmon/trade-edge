// lib/portfolioReview/buildPortfolioReview.ts
//
// PI-0012A: Portfolio Review, Phase 1 -- Composition Layer.
//
// A pure function only: no fetch, no Redis, no React, nothing reads the
// clock except via the explicit, overridable `now` parameter (matching this
// codebase's existing convention, e.g. evaluatePositionObjective(input, now)).
// Every value in the returned PortfolioReviewSnapshot is either a verbatim
// pass-through of an already-computed input (health, individual objectives,
// already-scored PrioritizedObjective entries) or a direct aggregation
// (count, sum, max, fraction) over fields the caller already supplies --
// nothing here evaluates a position, ranks an objective, or computes a new
// score. See docs/design/PI-0012-Portfolio-Review-Architecture.md for the
// full rationale and the Phase 2/3 items (trailing performance, decision
// quality) deliberately not included here.

import { derivePositionConcentration, deriveWheelDominance } from '@/lib/portfolio-intelligence';
import type { PortfolioObjective } from '@/lib/portfolio-intelligence';
import type { PrioritizedObjective, TodaysPrioritiesDashboard } from '@/lib/todaysPriorities';
import type {
  PortfolioReviewComposition,
  PortfolioReviewCurrentState,
  PortfolioReviewInput,
  PortfolioReviewPositionInput,
  PortfolioReviewSnapshot,
} from './types';

export const DEFAULT_TOP_RISKS_LIMIT = 5;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

// The direct generalization of lib/todaysPriorities' own selectTopPriority()
// from "pick the single highest-scoring head" to "pick the top N" --
// candidates are drawn from exactly the same actionable buckets
// selectTopPriority() already considers (every bucket already backed by a
// scored PortfolioObjective; Monitor and Covered Call/Screener opportunities
// are excluded there for the same reason). Every `.score` read here was
// already computed once by calculatePriorityScore() inside
// buildTodaysPrioritiesDashboard() -- this function only sorts and slices
// already-scored entries; it never re-scores or re-ranks anything.
export function selectTopRisks(
  dashboard: TodaysPrioritiesDashboard,
  limit: number = DEFAULT_TOP_RISKS_LIMIT,
): PrioritizedObjective[] {
  const candidates: PrioritizedObjective[] = [
    ...dashboard.immediateAction,
    ...dashboard.reviewToday.mediumPriority,
    ...dashboard.reviewToday.earningsReviews,
    ...dashboard.reviewToday.expiringPositions,
    ...dashboard.opportunities.rollOpportunities,
    ...dashboard.opportunities.cspOpportunities,
  ];

  return candidates
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, limit));
}

function buildCurrentState(input: PortfolioReviewInput, topRisksLimit: number): PortfolioReviewCurrentState {
  const concentrationConcerns = input.objectives.filter((o) => o.type === 'REDUCE_CONCENTRATION');
  const capitalConcerns = input.objectives.filter(
    (o): o is PortfolioObjective => o.type === 'PRESERVE_BUYING_POWER' || o.type === 'DEPLOY_IDLE_CASH',
  );
  const incomeConcern = input.objectives.find((o) => o.type === 'INCREASE_INCOME') ?? null;

  return {
    health: input.health,
    topRisks: selectTopRisks(input.dashboard, topRisksLimit),
    concentrationConcerns,
    capitalConcerns,
    incomeConcern,
  };
}

function buildComposition(
  positions: PortfolioReviewPositionInput[],
  netLiquidity: number | null,
): PortfolioReviewComposition {
  const byStrategy: Record<string, number> = {};
  for (const p of positions) {
    const key = p.strategy || 'UNKNOWN';
    byStrategy[key] = (byStrategy[key] ?? 0) + 1;
  }

  // Reuses derivePositionConcentration() exactly -- the same pure function
  // computeCanonicalPortfolioPriorities() and the Portfolio Health input
  // already call. Non-finite/missing maxRisk is treated as 0 exposure by
  // that function itself; netLiquidity <= 0 or unavailable returns {}.
  const exposureInputs = positions.map((p) => ({
    symbol: p.symbol,
    maxRisk: isFiniteNumber(p.maxRisk) ? p.maxRisk : 0,
    positionStrategy: p.positionStrategy ?? null,
    assignmentPreference: p.assignmentPreference ?? null,
  }));
  const symbolConcentrationPct = derivePositionConcentration(exposureInputs, netLiquidity ?? undefined);
  const concentrationValues = Object.values(symbolConcentrationPct);
  const maxSymbolConcentrationPct = concentrationValues.length > 0 ? Math.max(...concentrationValues) : null;

  // deriveWheelDominance() already computes, per symbol, what fraction of
  // that symbol's exposure is Wheel-managed (positionStrategy === 'WHEEL' &&
  // assignmentPreference === 'PREFER') -- the classification itself lives
  // only there, never duplicated here. This aggregates those per-symbol
  // fractions into one portfolio-level fraction by weighting each symbol's
  // fraction by its own total exposure (a symbol absent from the map
  // contributes 0 Wheel exposure, matching deriveWheelDominance()'s own
  // "missing means none, not fabricated" convention).
  const totalBySymbol: Record<string, number> = {};
  for (const p of exposureInputs) {
    totalBySymbol[p.symbol] = (totalBySymbol[p.symbol] ?? 0) + p.maxRisk;
  }
  const totalExposure = Object.values(totalBySymbol).reduce((sum, v) => sum + v, 0);

  const wheelDominanceBySymbol = deriveWheelDominance(exposureInputs);
  const wheelExposure = Object.entries(wheelDominanceBySymbol).reduce(
    (sum, [symbol, fraction]) => sum + fraction * (totalBySymbol[symbol] ?? 0),
    0,
  );

  const wheelManagedFraction = totalExposure > 0 ? wheelExposure / totalExposure : null;

  return {
    positionCount: positions.length,
    byStrategy,
    symbolConcentrationPct,
    maxSymbolConcentrationPct,
    wheelManagedFraction,
  };
}

export function buildPortfolioReview(input: PortfolioReviewInput, now: Date = new Date()): PortfolioReviewSnapshot {
  const topRisksLimit = input.topRisksLimit ?? DEFAULT_TOP_RISKS_LIMIT;

  return {
    generatedAt: now.toISOString(),
    currentState: buildCurrentState(input, topRisksLimit),
    composition: buildComposition(input.positions, input.netLiquidity),
  };
}
