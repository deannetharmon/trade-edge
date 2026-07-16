// lib/portfolioHealth/config.ts
//
// PI-0011B: Portfolio Health Engine -- the single centralized place every
// Portfolio Health Score weight, reference scale, and status cutoff lives.
// Mirrors lib/priorityScore/config.ts's pattern exactly: retuning how much a
// factor should move the score, or where Healthy/Needs Attention/Action
// Required cut off, means editing values in this file only -- the scoring
// logic in portfolioHealth.ts never changes.

export interface PortfolioHealthFactorWeights {
  immediateActions: number;
  criticalPositions: number;
  earningsConcentration: number;
  capitalDeployment: number;
  cashAllocation: number;
  // No real sector data source exists anywhere in this codebase today (every
  // `Position`/`PortfolioObjective` producer has zero sector field -- see
  // portfolioHealth.ts's module doc for the confirming search). Weight is 0
  // so this factor is computed (for forward compatibility) but never moves
  // the score or appears as a contributor until a real sector data source
  // exists -- flip this to a positive number then, no code change needed.
  sectorConcentration: number;
  positionConcentration: number;
  averagePositionHealth: number;
  averageDecisionConfidence: number;
  decisionReviewFollowUp: number;
}

export interface PortfolioHealthConfig {
  factorWeights: PortfolioHealthFactorWeights;
  // Count of Immediate Action items at or above which this factor is fully
  // (-1) unhealthy; 0 items is fully (+1) healthy, scales linearly between.
  immediateActionsReferenceCount: number;
  // Count of distinct positions carrying `priority === 'critical'` at or
  // above which this factor is fully unhealthy.
  criticalPositionsReferenceCount: number;
  // Fraction (0-1) of all positions carrying an earnings review trigger at
  // or above which this factor is fully unhealthy.
  earningsConcentrationReferenceFraction: number;
  // buyingPowerUsedPct at or above which Capital Deployment is fully
  // unhealthy (little buffer left).
  capitalDeploymentReferencePct: number;
  // idleCashPct (cashBalance / netLiquidity * 100) at or above which Cash
  // Allocation is fully unhealthy (capital sitting idle instead of working).
  idleCashReferencePct: number;
  // Max single-symbol concentration pct (of net liquidity) at or above
  // which Position Concentration is fully unhealthy.
  positionConcentrationReferencePct: number;
  // Count of Decision Reviews needing follow-up at or above which this
  // factor is fully unhealthy.
  decisionReviewFollowUpReferenceCount: number;
  // Neutral (0 health-impact) fallback used when a factor's underlying data
  // is genuinely unavailable (e.g. no live balances fetched yet) -- neither
  // rewards nor penalizes the score for data that was never observed.
  missingDataHealthImpact: number;
  // Score (0-100) cutoffs for the displayed status. >= healthy -> "Healthy";
  // >= attention (and below healthy) -> "Needs Attention"; below attention
  // -> "Action Required".
  statusThresholds: { healthy: number; attention: number };
  // A factor's health-impact magnitude (0-1 scale, see portfolioHealth.ts)
  // must be at or above this to be surfaced as a positive or negative
  // contributor.
  contributorInclusionThreshold: number;
  // Maximum number of contributors shown per direction (positive/negative).
  maxContributors: number;
}

export const DEFAULT_PORTFOLIO_HEALTH_CONFIG: PortfolioHealthConfig = {
  factorWeights: {
    immediateActions: 20,
    criticalPositions: 15,
    earningsConcentration: 8,
    capitalDeployment: 10,
    cashAllocation: 7,
    sectorConcentration: 0,
    positionConcentration: 10,
    averagePositionHealth: 15,
    averageDecisionConfidence: 8,
    decisionReviewFollowUp: 7,
  },
  immediateActionsReferenceCount: 5,
  criticalPositionsReferenceCount: 5,
  earningsConcentrationReferenceFraction: 0.3,
  capitalDeploymentReferencePct: 90,
  idleCashReferencePct: 50,
  positionConcentrationReferencePct: 40,
  decisionReviewFollowUpReferenceCount: 5,
  missingDataHealthImpact: 0,
  statusThresholds: { healthy: 75, attention: 50 },
  contributorInclusionThreshold: 0.15,
  maxContributors: 3,
};
