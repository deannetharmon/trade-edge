// lib/portfolioReview/types.ts
//
// PI-0012A: Portfolio Review, Phase 1 -- Composition Layer.
//
// Every type here is either a direct re-export/reuse of an existing type
// (PortfolioHealthResult, PrioritizedObjective, PortfolioObjective) or a
// plain aggregate primitive (count, Pct, Record<string, number>). There is
// no new score, no new confidence value, and no new recommendation --
// see docs/design/PI-0012-Portfolio-Review-Architecture.md's Data Model and
// Scoring Proposal sections, which this file implements verbatim for Phase 1
// (current state + composition only; performance and decision-quality
// rollups are explicitly deferred to PI-0012B/C, see that document's
// Recommended Implementation Phases).

import type { PortfolioObjective, AssignmentPreference, PositionStrategy } from '@/lib/portfolio-intelligence';
import type { PrioritizedObjective, TodaysPrioritiesDashboard } from '@/lib/todaysPriorities';
import type { PortfolioHealthResult } from '@/lib/portfolioHealth';

// ---------------------------------------------------------------------------
// Input -- everything here is a value the caller (app/portfolio/page.tsx)
// already computed for some other purpose. Nothing is fetched, evaluated, or
// re-ranked by this module.
// ---------------------------------------------------------------------------

// Lean, page-agnostic per-position shape -- deliberately narrower than
// app/portfolio/page.tsx's `Position` interface (same pattern as
// lib/position-snapshot's PositionSnapshotInput / lib/todaysPriorities'
// TodaysPrioritiesPositionInput), so this module has no dependency on that
// file and stays independently testable. `strategy` is the position's own
// raw strategy label (e.g. 'BPS', 'CSP', 'COVERED CALL') exactly as already
// carried elsewhere on the page -- grouped as-is, not coerced into a
// normalized enum, since no such normalization exists today for live
// positions (see the architecture doc's Risks: "Strategy bucket coverage").
export interface PortfolioReviewPositionInput {
  symbol: string;
  strategy: string;
  // Theoretical max loss -- Position.maxRisk on the Portfolio page already
  // provides this for every open position (same field
  // adapters/balancesNormalization.ts's PositionExposureInput uses).
  // `null`/non-finite is treated as 0 exposure, never fabricated or thrown.
  maxRisk: number | null;
  // PI-0004B fields, optional and independent (see lib/portfolio-intelligence
  // types.ts) -- feed the Wheel-managed fraction below using the exact same
  // WHEEL + PREFER classification deriveWheelDominance() already uses.
  // Absent on legacy/unclassified positions, never defaulted.
  positionStrategy?: PositionStrategy | null;
  assignmentPreference?: AssignmentPreference | null;
}

export interface PortfolioReviewInput {
  // PI-0011B's already-computed result -- reused verbatim, never recomputed.
  health: PortfolioHealthResult;
  // The canonical, already-ranked objective list (same list Mission
  // Control's Portfolio Summary and Briefing already read) -- filtered
  // internally by `type` for concentration/capital/income concerns. Not
  // re-evaluated; every objective here was already produced by
  // evaluatePortfolioObjectives().
  objectives: PortfolioObjective[];
  // PI-0010A/B's already-bucketed-and-scored dashboard -- Top Risks is a
  // read of already-computed `.score` values across its actionable buckets,
  // never a new ranking pass (see selectTopRisks() in buildPortfolioReview.ts,
  // the direct generalization of lib/todaysPriorities' own
  // selectTopPriority() from "top 1" to "top N").
  dashboard: TodaysPrioritiesDashboard;
  positions: PortfolioReviewPositionInput[];
  // Real account balance, already fetched by the Portfolio page (the same
  // value healthInput/canonicalPriorities already use). `null` means
  // genuinely not yet available -- never fabricated as 0.
  netLiquidity: number | null;
  // How many Top Risks entries to surface (spec: "3-5 items"). Optional,
  // defaults to 5 in buildPortfolioReview.ts.
  topRisksLimit?: number;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface PortfolioReviewCurrentState {
  health: PortfolioHealthResult;
  topRisks: PrioritizedObjective[];
  concentrationConcerns: PortfolioObjective[];
  capitalConcerns: PortfolioObjective[];
  incomeConcern: PortfolioObjective | null;
}

export interface PortfolioReviewComposition {
  positionCount: number;
  // Count of open positions per raw strategy label. Empty object (not a
  // fabricated zero-filled map) when there are no positions.
  byStrategy: Record<string, number>;
  // Reuses derivePositionConcentration() exactly -- empty {} when
  // netLiquidity is unavailable, zero, or negative (that function's own
  // "never a divide-by-zero, never fabricated" behavior, unchanged).
  symbolConcentrationPct: Record<string, number>;
  // `null` -- not 0 -- when there is no concentration data to compute a max
  // over.
  maxSymbolConcentrationPct: number | null;
  // Fraction (0-1) of total position exposure (sum of maxRisk) that is
  // Wheel-managed (positionStrategy === 'WHEEL' && assignmentPreference ===
  // 'PREFER') -- the same classification deriveWheelDominance() already
  // uses per-symbol, aggregated here to a single portfolio-level fraction.
  // `null` when there is no exposure to compute a fraction over (never a
  // fabricated 0).
  wheelManagedFraction: number | null;
}

export interface PortfolioReviewSnapshot {
  generatedAt: string;
  currentState: PortfolioReviewCurrentState;
  composition: PortfolioReviewComposition;
}
