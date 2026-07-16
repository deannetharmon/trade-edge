// lib/portfolioHealth/portfolioHealth.ts
//
// PI-0011B: Portfolio Health Engine -- a deterministic Portfolio Health
// Score (0-100) answering "how healthy is the portfolio as a whole, right
// now?". Purely arithmetic over portfolio metrics that already exist
// elsewhere in this codebase (Today's Priorities' bucket counts, per-position
// health scores and objective confidence already computed by Position
// Intelligence, real account balances, Decision Review follow-up counts) --
// nothing here evaluates a position, fetches market data, or produces a new
// recommendation. Mirrors lib/priorityScore's architecture exactly: a
// centralized config (see config.ts) of weights/reference scales/thresholds,
// and a single scoring function that combines factor "health impacts" (-1
// fully unhealthy, +1 fully healthy) into one weighted score plus the
// top positive/negative contributors.
//
// Sector concentration: confirmed via repo-wide search that no `Position` or
// `PortfolioObjective` producer anywhere carries a sector field --
// `sectorConcentrationPct: {}` is permanently hardcoded empty in
// lib/portfolio-intelligence/adapters/portfolioIntelligenceAdapter.ts with
// its own comment ("no sector data exists anywhere in the app yet"), and the
// only other `sector` field in the codebase (lib/autopilot/types.ts,
// screener candidates) is likewise always left undefined. This engine still
// computes a Sector Concentration factor (for forward compatibility and so
// the ticket's own factor list is fully represented) but its weight
// defaults to 0 in config.ts, so it never moves the score or appears as a
// contributor until a real sector data source exists -- consistent with
// "do not create new market data".

import { DEFAULT_PORTFOLIO_HEALTH_CONFIG, type PortfolioHealthConfig } from './config';

export type PortfolioHealthStatus = 'Healthy' | 'Needs Attention' | 'Action Required';

export interface PortfolioHealthContributor {
  id: string;
  label: string;
}

export interface PortfolioHealthInput {
  // Today's Priorities' own Immediate Action bucket count (PI-0010A) --
  // already the canonical "how many things need action right now" number.
  immediateActionsCount: number;
  // Distinct positions whose objective carries `priority === 'critical'`
  // (the caller dedupes by position key across the full, unfiltered
  // per-position objective list).
  criticalPositionsCount: number;
  totalPositionsCount: number;
  // Positions whose objective carries an earnings review trigger, across
  // the full per-position objective list (not just currently-actionable
  // ones -- earnings concentration is a standing exposure, not a today-only
  // action item).
  earningsExposedPositionsCount: number;
  // Real account balance fields (PortfolioFinancialContext, already fetched
  // by app/portfolio/page.tsx's loadAccountBalances()). `null` means
  // genuinely not yet available -- never fabricated.
  buyingPowerUsedPct: number | null;
  cashBalance: number | null;
  netLiquidity: number | null;
  // Max single-symbol concentration pct of net liquidity, from the same
  // derivePositionConcentration() function computeCanonicalPortfolioPriorities
  // already uses internally -- `null` when balances/positions aren't
  // available to compute it yet.
  maxSymbolConcentrationPct: number | null;
  // 0-100 average across positions with a computed PositionHealthScore;
  // `null` when no position has one yet.
  averagePositionHealth: number | null;
  // 0-100 average of PortfolioObjective.confidence across the full
  // per-position objective list; `null` when there are no objectives yet.
  averageDecisionConfidence: number | null;
  // Today's Priorities' own Decision Reviews Needing Follow-Up count
  // (PI-0008D's reviewsNeedingFollowUp(), already surfaced there).
  decisionReviewsNeedingFollowUpCount: number;
}

export interface PortfolioHealthResult {
  score: number; // 0-100, rounded
  status: PortfolioHealthStatus;
  positiveContributors: PortfolioHealthContributor[];
  negativeContributors: PortfolioHealthContributor[];
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

// Converts a 0-1 "penalty" (0 = no problem, 1 = maximally unhealthy) into a
// -1..+1 health impact (+1 fully healthy, -1 fully unhealthy) -- the
// symmetric scale this engine scores and picks contributors from.
function impactFromPenalty(penalty: number): number {
  return 1 - 2 * clamp01(penalty);
}

interface HealthFactor {
  id: string;
  weight: number;
  impact: number; // -1..1
  positiveLabel: string;
  negativeLabel: string;
}

export function calculatePortfolioHealthScore(
  input: PortfolioHealthInput,
  config: PortfolioHealthConfig = DEFAULT_PORTFOLIO_HEALTH_CONFIG,
): PortfolioHealthResult {
  const w = config.factorWeights;

  const immediateActionsPenalty = clamp01(input.immediateActionsCount / config.immediateActionsReferenceCount);
  const criticalPositionsPenalty = clamp01(input.criticalPositionsCount / config.criticalPositionsReferenceCount);

  const earningsFraction = input.totalPositionsCount > 0 ? input.earningsExposedPositionsCount / input.totalPositionsCount : 0;
  const earningsPenalty = clamp01(earningsFraction / config.earningsConcentrationReferenceFraction);

  const capitalDeploymentImpact =
    input.buyingPowerUsedPct != null
      ? impactFromPenalty(clamp01(input.buyingPowerUsedPct / config.capitalDeploymentReferencePct))
      : config.missingDataHealthImpact;

  const idleCashPct =
    input.cashBalance != null && input.netLiquidity != null && input.netLiquidity > 0
      ? (input.cashBalance / input.netLiquidity) * 100
      : null;
  const cashAllocationImpact =
    idleCashPct != null ? impactFromPenalty(clamp01(idleCashPct / config.idleCashReferencePct)) : config.missingDataHealthImpact;

  // Sector concentration: no real data source exists (see module doc) --
  // always perfectly neutral. Weight is 0 by default so this never moves
  // the score regardless of this value.
  const sectorConcentrationImpact = 0;

  const positionConcentrationImpact =
    input.maxSymbolConcentrationPct != null
      ? impactFromPenalty(clamp01(input.maxSymbolConcentrationPct / config.positionConcentrationReferencePct))
      : config.missingDataHealthImpact;

  const averagePositionHealthImpact =
    input.averagePositionHealth != null
      ? impactFromPenalty(clamp01((100 - input.averagePositionHealth) / 100))
      : config.missingDataHealthImpact;

  const averageDecisionConfidenceImpact =
    input.averageDecisionConfidence != null
      ? impactFromPenalty(clamp01((100 - input.averageDecisionConfidence) / 100))
      : config.missingDataHealthImpact;

  const decisionReviewFollowUpPenalty = clamp01(input.decisionReviewsNeedingFollowUpCount / config.decisionReviewFollowUpReferenceCount);

  const factors: HealthFactor[] = [
    {
      id: 'immediateActions',
      weight: w.immediateActions,
      impact: impactFromPenalty(immediateActionsPenalty),
      positiveLabel: 'No immediate actions pending',
      negativeLabel: `${input.immediateActionsCount} immediate action${input.immediateActionsCount === 1 ? '' : 's'} pending`,
    },
    {
      id: 'criticalPositions',
      weight: w.criticalPositions,
      impact: impactFromPenalty(criticalPositionsPenalty),
      positiveLabel: 'No positions in critical condition',
      negativeLabel: `${input.criticalPositionsCount} position${input.criticalPositionsCount === 1 ? '' : 's'} in critical condition`,
    },
    {
      id: 'earningsConcentration',
      weight: w.earningsConcentration,
      impact: impactFromPenalty(earningsPenalty),
      positiveLabel: 'Low earnings concentration',
      negativeLabel: `High earnings concentration (${Math.round(earningsFraction * 100)}% of positions)`,
    },
    {
      id: 'capitalDeployment',
      weight: w.capitalDeployment,
      impact: capitalDeploymentImpact,
      positiveLabel: 'Buying power utilization healthy',
      negativeLabel: input.buyingPowerUsedPct != null
        ? `Buying power utilization elevated (${Math.round(input.buyingPowerUsedPct)}%)`
        : 'Buying power utilization elevated',
    },
    {
      id: 'cashAllocation',
      weight: w.cashAllocation,
      impact: cashAllocationImpact,
      positiveLabel: 'Cash allocation efficient',
      negativeLabel: idleCashPct != null
        ? `Excess idle cash (${Math.round(idleCashPct)}% of net liquidity)`
        : 'Excess idle cash',
    },
    {
      id: 'sectorConcentration',
      weight: w.sectorConcentration,
      impact: sectorConcentrationImpact,
      positiveLabel: 'Sector concentration within policy',
      negativeLabel: 'Sector concentration elevated',
    },
    {
      id: 'positionConcentration',
      weight: w.positionConcentration,
      impact: positionConcentrationImpact,
      positiveLabel: 'Position concentration within policy',
      negativeLabel: input.maxSymbolConcentrationPct != null
        ? `Concentration elevated in one symbol (${Math.round(input.maxSymbolConcentrationPct)}% of net liquidity)`
        : 'Concentration elevated in one symbol',
    },
    {
      id: 'averagePositionHealth',
      weight: w.averagePositionHealth,
      impact: averagePositionHealthImpact,
      positiveLabel: input.averagePositionHealth != null
        ? `Average position health strong (${Math.round(input.averagePositionHealth)})`
        : 'Average position health strong',
      negativeLabel: input.averagePositionHealth != null
        ? `Average position health weak (${Math.round(input.averagePositionHealth)})`
        : 'Average position health weak',
    },
    {
      id: 'averageDecisionConfidence',
      weight: w.averageDecisionConfidence,
      impact: averageDecisionConfidenceImpact,
      positiveLabel: input.averageDecisionConfidence != null
        ? `Decision confidence strong (${Math.round(input.averageDecisionConfidence)})`
        : 'Decision confidence strong',
      negativeLabel: input.averageDecisionConfidence != null
        ? `Decision confidence low (${Math.round(input.averageDecisionConfidence)})`
        : 'Decision confidence low',
    },
    {
      id: 'decisionReviewFollowUp',
      weight: w.decisionReviewFollowUp,
      impact: impactFromPenalty(decisionReviewFollowUpPenalty),
      positiveLabel: 'No decision reviews awaiting follow-up',
      negativeLabel: `${input.decisionReviewsNeedingFollowUpCount} decision review${input.decisionReviewsNeedingFollowUpCount === 1 ? '' : 's'} awaiting follow-up`,
    },
  ];

  const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
  const weightedImpact = factors.reduce((sum, f) => sum + f.impact * f.weight, 0);
  const normalizedImpact = totalWeight > 0 ? weightedImpact / totalWeight : 0; // -1..1
  const score = Math.round(clamp01((normalizedImpact + 1) / 2) * 100);

  const status: PortfolioHealthStatus =
    score >= config.statusThresholds.healthy ? 'Healthy' :
    score >= config.statusThresholds.attention ? 'Needs Attention' :
    'Action Required';

  const contributions = factors.map((f) => ({ ...f, contribution: f.impact * f.weight }));

  const positiveContributors: PortfolioHealthContributor[] = contributions
    .filter((f) => f.impact >= config.contributorInclusionThreshold && f.weight > 0)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, config.maxContributors)
    .map((f) => ({ id: f.id, label: f.positiveLabel }));

  const negativeContributors: PortfolioHealthContributor[] = contributions
    .filter((f) => f.impact <= -config.contributorInclusionThreshold && f.weight > 0)
    .sort((a, b) => a.contribution - b.contribution)
    .slice(0, config.maxContributors)
    .map((f) => ({ id: f.id, label: f.negativeLabel }));

  return { score, status, positiveContributors, negativeContributors };
}
