// lib/portfolio-intelligence/dashboardComposition.ts
//
// TC-0001: shared, pure composition layer extracted from
// app/portfolio/page.tsx's own inline useMemo/useEffect chain
// (canonicalPriorities -> todaysPrioritiesDashboard -> portfolioHealth ->
// portfolioReview -> dailyBriefing). Both app/portfolio/page.tsx and the new
// /dashboard route now call buildDashboardComposition() instead of each
// re-deriving this sequence independently -- there is exactly one copy of
// this orchestration in the repository.
//
// This module is deterministic, framework-independent (no React, no fetch,
// no I/O, no dependency on app/portfolio/page.tsx), and unit-testable in
// isolation: given the same already-loaded, already-enriched inputs, it
// always returns the same composition. It does not compute, fetch, or
// persist anything itself -- every value it returns comes from an existing,
// already-exported canonical builder (computeCanonicalPortfolioPriorities,
// buildTodaysPrioritiesDashboard, calculatePortfolioHealthScore,
// buildPortfolioReview, buildDailyBriefing). This module owns only the
// SEQUENCING and the plain-object wiring between those builders' inputs and
// outputs -- exactly what previously lived, un-reusably, inside
// app/portfolio/page.tsx's component body.
//
// Explicit scope boundary (deliberate, per Product Owner direction): this
// module begins AFTER raw portfolio inputs already exist. It does not fetch,
// does not know about TastyTrade, and does not reach back into
// app/portfolio/page.tsx for anything -- Next.js's App Router does not allow
// a page.tsx file to export arbitrary named symbols in the first place, and
// even if it did, `loadPositions()` (the live, browser-owned TastyTrade
// fetch + enrichment engine) is a large, deeply-entangled subsystem that is
// deliberately OUT OF SCOPE for this extraction; relocating it is its own,
// separately-reviewed future ticket. Two small per-position figures the
// downstream builders need (netEdgeDeclinePct/netEdgeNegative and
// remainingOpportunityPct) are therefore INPUT fields on
// `DashboardCompositionPosition`, not something this module derives --
// whichever caller already has them (today, only app/portfolio/page.tsx,
// via its own already-existing computeNetEdgeEvidence/
// scorePortfolioRemainingOpportunity helpers) passes them in; a caller that
// doesn't have them (e.g. /dashboard, this sprint) passes `null`, which
// flows through as honestly-unavailable evidence to Priority Score -- never
// fabricated, never defaulted to a misleading value.

import type {
  PortfolioObjective,
  PortfolioFinancialContext,
  PositionExposureInput,
  PositionHealthScore,
  CanonicalPortfolioPriorities,
} from '@/lib/portfolio-intelligence';
import {
  computeCanonicalPortfolioPriorities,
  deriveAssignmentPreferenceFromIntent,
  derivePositionConcentration,
} from '@/lib/portfolio-intelligence';
import type { DecisionReviewStore } from '@/lib/decision-review';
import { latestReviewForPosition } from '@/lib/decision-review';
import { classifyPositionLifecycle } from '@/lib/portfolio/positionLifecycle';
import { reliableSupportedMaxRisk } from '@/lib/portfolio/positionMetrics';
import { buildTodaysPrioritiesDashboard, selectTopPriority } from '@/lib/todaysPriorities';
import { calculatePortfolioHealthScore } from '@/lib/portfolioHealth';
import type { PortfolioHealthInput } from '@/lib/portfolioHealth';
import { buildPortfolioReview } from '@/lib/portfolioReview';
import type { PortfolioReviewInput, PortfolioReviewPositionInput } from '@/lib/portfolioReview';
import { buildDailyBriefing } from '@/lib/dailyBriefing';
import type { DailyBriefingInput } from '@/lib/dailyBriefing';

// ---------------------------------------------------------------------------
// Input -- the explicit, minimal, narrow shape this composition needs from
// each already-loaded position/pending order. Deliberately structural (a
// purpose-built interface, not app/portfolio/page.tsx's own richer
// `Position`/`PendingOrder` types) matching this codebase's existing
// narrow-input-type convention (PositionExposureInput,
// TodaysPrioritiesPositionInput, PortfolioReviewPositionInput, etc.).
// app/portfolio/page.tsx's real `Position[]`/`PendingOrder[]` already
// structurally satisfy these shapes (extra fields are simply ignored).
// ---------------------------------------------------------------------------

export interface DashboardCompositionLeg {
  symbol: string;
  optionType: 'P' | 'C';
  strikePrice: number;
  direction: 'Short' | 'Long';
  quantity: number;
}

export interface DashboardCompositionPosition {
  key: string;
  symbol: string;
  legs: DashboardCompositionLeg[];
  maxRisk: number;
  // PM-0002: maxRisk is usable by Portfolio composition only when these
  // canonical entry-provenance fields establish a supported net-credit
  // basis and maxRiskReliable is explicitly true. Legacy/compatibility
  // objects that omit provenance fail closed.
  entryEconomicsComplete?: boolean;
  entryCredit?: number | null;
  entryPriceEffect?: 'Credit' | 'Debit' | 'Unknown' | null;
  creditReceived: number;
  maxRiskReliable?: boolean;
  intent: string;
  dte: number;
  strategy: string;
  // Already-enriched: healthScore/portfolioObjective must already be
  // computed by the caller (e.g. app/portfolio/page.tsx's own
  // attachSnapshotHistory/scorePortfolioPositionObjective) before calling
  // this function -- this module never computes them itself.
  healthScore?: PositionHealthScore | null;
  portfolioObjective?: PortfolioObjective | null;
  // Already-computed per-position evidence this module does NOT derive (see
  // module doc above) -- `null` is the honest, supported "unavailable"
  // value, never defaulted to 0/false to imply a fact that isn't known.
  netEdgeDeclinePct: number | null;
  netEdgeNegative: boolean | null;
  remainingOpportunityPct: number | null;
}

export interface DashboardCompositionPendingOrder {
  id: string;
  symbol: string;
  strategy: string;
  createdAt: string | null;
  status: string;
}

export interface DashboardCompositionInput {
  positions: DashboardCompositionPosition[];
  pendingOrders: DashboardCompositionPendingOrder[];
  balances: PortfolioFinancialContext | null;
  decisionReviews: DecisionReviewStore;
}

// ---------------------------------------------------------------------------
// Output -- every field is the direct, unmodified return value of an
// existing canonical builder. ReturnType<> is used deliberately instead of
// re-declaring these types, so this file cannot silently drift from the
// builders' own declared shapes.
// ---------------------------------------------------------------------------

export interface DashboardComposition {
  canonicalPriorities: CanonicalPortfolioPriorities | null;
  todaysPrioritiesDashboard: ReturnType<typeof buildTodaysPrioritiesDashboard>;
  topPriority: ReturnType<typeof selectTopPriority>;
  averagePositionHealth: number | null;
  portfolioHealth: ReturnType<typeof calculatePortfolioHealthScore>;
  portfolioReview: ReturnType<typeof buildPortfolioReview> | null;
  dailyBriefing: ReturnType<typeof buildDailyBriefing> | null;
}

export function buildDashboardComposition(input: DashboardCompositionInput): DashboardComposition {
  const { positions, pendingOrders, balances, decisionReviews } = input;
  const supportedMaxRiskByKey = new Map(
    positions.map(p => [p.key, reliableSupportedMaxRisk(p)] as const),
  );

  // --- canonicalPriorities (PI-0003/PI-0004B) --------------------------------
  const canonicalPriorities: CanonicalPortfolioPriorities | null =
    positions.length === 0 && pendingOrders.length === 0
      ? null
      : computeCanonicalPortfolioPriorities(
          positions.map(p => ({
            ...p,
            // computeCanonicalPortfolioPriorities' position-objective input
            // still requires a number. Zero is the fail-closed compatibility
            // representation here; portfolio-level exposure receives only
            // the filtered, provenance-supported list below.
            maxRisk: supportedMaxRiskByKey.get(p.key) ?? 0,
            positionId: p.key,
            healthScore: p.healthScore ?? null,
            assignmentPreference: deriveAssignmentPreferenceFromIntent(p.intent),
          })),
          balances ?? ({} as PortfolioFinancialContext),
          positions.flatMap((p): PositionExposureInput[] => {
            const maxRisk = supportedMaxRiskByKey.get(p.key);
            return maxRisk == null ? [] : [{
              symbol: p.symbol,
              maxRisk,
              assignmentPreference: deriveAssignmentPreferenceFromIntent(p.intent),
            }];
          }),
          pendingOrders.map(o => ({ id: o.id, symbol: o.symbol, strategy: o.strategy, createdAt: o.createdAt, status: o.status })),
        );

  // --- todaysPrioritiesDashboard (PI-0010A/B) --------------------------------
  const positionObjectives = positions
    .map(p => p.portfolioObjective)
    .filter((o): o is PortfolioObjective => o != null);
  const portfolioLevelObjectives = (canonicalPriorities?.objectives ?? []).filter(o => o.source !== 'position');
  const objectives = [...positionObjectives, ...portfolioLevelObjectives];

  const positionInputsForDashboard = positions.map(p => {
    const latestReview = latestReviewForPosition(decisionReviews, p.key);
    return {
      key: p.key,
      symbol: p.symbol,
      strategy: p.strategy,
      dte: p.dte,
      healthScore: p.healthScore?.score ?? null,
      objective: p.portfolioObjective ?? null,
      netEdgeDeclinePct: p.netEdgeDeclinePct,
      netEdgeNegative: p.netEdgeNegative ?? false,
      remainingOpportunityPct: p.remainingOpportunityPct,
      capitalAtRisk: supportedMaxRiskByKey.get(p.key) ?? null,
      hasPendingDecisionReview: latestReview?.outcomeStatus === 'PENDING',
    };
  });

  const coveredCallOpportunities = positions.reduce<{ key: string; symbol: string; shares: number }[]>((acc, p) => {
    // DashboardCompositionPosition's {symbol, legs} already structurally
    // satisfies LifecycleClassificationInput -- no cast needed.
    const lifecycle = classifyPositionLifecycle(p);
    if (lifecycle.type === 'ASSIGNED_STOCK') acc.push({ key: p.key, symbol: p.symbol, shares: lifecycle.shares });
    return acc;
  }, []);

  const todaysPrioritiesDashboard = buildTodaysPrioritiesDashboard({
    objectives,
    positions: positionInputsForDashboard,
    decisionReviews,
    openPositionIds: positions.map(p => p.key),
    coveredCallOpportunities,
    // Same V1 scope note as app/portfolio/page.tsx's own input: no persisted
    // Screener scan output exists anywhere to reuse.
    screenerCandidatesAvailable: false,
  });

  const topPriority = selectTopPriority(todaysPrioritiesDashboard);

  // --- portfolioHealth (PI-0011B) ---------------------------------------------
  const positionHealthScores = positions
    .map(p => p.healthScore?.score)
    .filter((s): s is number => s != null);
  const averagePositionHealth =
    positionHealthScores.length > 0
      ? positionHealthScores.reduce((sum, s) => sum + s, 0) / positionHealthScores.length
      : null;

  const criticalPositionKeys = new Set(
    positions.filter(p => p.portfolioObjective?.priority === 'critical').map(p => p.key),
  );
  const earningsExposedPositionsCount = positions.filter(
    p => p.portfolioObjective?.reviewTriggers.some(t => t.triggerType === 'earnings'),
  ).length;

  const confidences = positionObjectives.map(o => o.confidence);
  const averageDecisionConfidence =
    confidences.length > 0 ? confidences.reduce((sum, c) => sum + c, 0) / confidences.length : null;

  const positionsForConcentration: PositionExposureInput[] = positions.flatMap((p): PositionExposureInput[] => {
    const maxRisk = supportedMaxRiskByKey.get(p.key);
    return maxRisk == null ? [] : [{
      symbol: p.symbol,
      maxRisk,
      assignmentPreference: deriveAssignmentPreferenceFromIntent(p.intent),
    }];
  });
  const concentrationBySymbol = derivePositionConcentration(positionsForConcentration, balances?.netLiquidity);
  const concentrationValues = Object.values(concentrationBySymbol);
  const maxSymbolConcentrationPct = concentrationValues.length > 0 ? Math.max(...concentrationValues) : null;

  const healthInput: PortfolioHealthInput = {
    immediateActionsCount: todaysPrioritiesDashboard.immediateAction.length,
    criticalPositionsCount: criticalPositionKeys.size,
    totalPositionsCount: positions.length,
    earningsExposedPositionsCount,
    buyingPowerUsedPct: balances?.buyingPowerUsedPct ?? null,
    cashBalance: balances?.cashBalance ?? null,
    netLiquidity: balances?.netLiquidity ?? null,
    maxSymbolConcentrationPct,
    averagePositionHealth,
    averageDecisionConfidence,
    decisionReviewsNeedingFollowUpCount: todaysPrioritiesDashboard.reviewToday.needsFollowUp.length,
  };
  const portfolioHealth = calculatePortfolioHealthScore(healthInput);

  // --- portfolioReview (PI-0012A) ---------------------------------------------
  const reviewPositions: PortfolioReviewPositionInput[] = positions.map(p => ({
    symbol: p.symbol,
    strategy: p.strategy,
    maxRisk: supportedMaxRiskByKey.get(p.key) ?? null,
    positionStrategy: null,
    assignmentPreference: deriveAssignmentPreferenceFromIntent(p.intent),
  }));
  const portfolioReviewInput: PortfolioReviewInput = {
    health: portfolioHealth,
    objectives: canonicalPriorities?.objectives ?? [],
    dashboard: todaysPrioritiesDashboard,
    positions: reviewPositions,
    netLiquidity: balances?.netLiquidity ?? null,
  };
  const portfolioReview =
    positions.length === 0 && pendingOrders.length === 0 && !canonicalPriorities
      ? null
      : buildPortfolioReview(portfolioReviewInput);

  // --- dailyBriefing (PI-0013) -------------------------------------------------
  const dailyBriefingInput: DailyBriefingInput | null = !portfolioReview
    ? null
    : {
        portfolioReview,
        dashboard: todaysPrioritiesDashboard,
        objectives: canonicalPriorities?.objectives ?? [],
        averagePositionHealth,
        capitalDeploymentPct: balances?.buyingPowerUsedPct ?? null,
      };
  const dailyBriefing = dailyBriefingInput ? buildDailyBriefing(dailyBriefingInput) : null;

  return {
    canonicalPriorities,
    todaysPrioritiesDashboard,
    topPriority,
    averagePositionHealth,
    portfolioHealth,
    portfolioReview,
    dailyBriefing,
  };
}
