// lib/priorityScore/config.ts
//
// PI-0010B: Intelligent Prioritization -- the single centralized place every
// Priority Score weight, reference scale, and tier cutoff lives. The brief
// is explicit ("Allow future weighting changes from one centralized
// configuration"): retuning how urgently a factor should push the score, or
// where Critical/High/Medium/Low cut off, means editing values in this file
// only -- priorityScore.ts's calculation logic never changes.

import type { ManagementIntent } from '@/lib/portfolio-intelligence';

export interface PriorityScoreFactorWeights {
  confidence: number;
  managementIntent: number;
  gammaDte: number;
  netEdgeDeterioration: number;
  positionHealth: number;
  remainingOpportunity: number;
  earningsProximity: number;
  capitalAtRisk: number;
  decisionReviewFollowUp: number;
}

export interface PriorityScoreConfig {
  // Relative weight of each factor in the weighted average -- these do not
  // need to sum to any particular total; calculatePriorityScore() normalizes
  // by the sum of weights actually present.
  factorWeights: PriorityScoreFactorWeights;
  // How urgently each already-computed Management Intent (PI-0006B's
  // canonical intent selector) implies the trader should act on this
  // position today. HOLD_POSITION and DEPLOY_IDLE_CASH are deliberately low
  // -- "hold" is the do-nothing outcome, and idle cash is an opportunity, not
  // an urgent risk. Values are 0-1.
  managementIntentUrgency: Record<ManagementIntent, number>;
  // Used when an objective has no managementIntent at all (REDUCE_CONCENTRATION,
  // PRESERVE_BUYING_POWER, INCREASE_INCOME, WAIT -- see PortfolioObjective's
  // own doc comment on the managementIntent field).
  defaultManagementIntentUrgency: number;
  // netEdgeDeclinePct at or above this reference maps to full (1.0) urgency
  // for the Net Edge Deterioration factor; anything below scales linearly.
  netEdgeDeclineReferencePct: number;
  // Dollar amount at or above which the Capital At Risk factor is fully (1.0)
  // saturated; scales linearly below that.
  capitalAtRiskReferenceUsd: number;
  // Neutral default for Position Health / Remaining Opportunity when no
  // position context is available at all (e.g. a portfolio-level objective
  // with no single position to look health up on) -- neither pushes the
  // score up nor down.
  missingPositionHealthFactor: number;
  missingRemainingOpportunityFactor: number;
  // Score (0-100) cutoffs for the displayed Critical/High/Medium/Low tier.
  // A score is Critical if >= tierThresholds.critical, High if >=
  // tierThresholds.high (and below critical), etc.; anything below
  // tierThresholds.medium is Low.
  tierThresholds: { critical: number; high: number; medium: number };
  // A factor's normalized 0-1 value must be at or above this to be surfaced
  // as one of the "Reason" bullets on a priority card.
  reasonInclusionThreshold: number;
  // Maximum number of reason bullets shown per card, highest-contribution
  // first.
  maxReasons: number;
}

export const DEFAULT_PRIORITY_SCORE_CONFIG: PriorityScoreConfig = {
  factorWeights: {
    confidence: 15,
    managementIntent: 20,
    gammaDte: 15,
    netEdgeDeterioration: 15,
    positionHealth: 10,
    remainingOpportunity: 10,
    earningsProximity: 8,
    capitalAtRisk: 5,
    decisionReviewFollowUp: 2,
  },
  managementIntentUrgency: {
    CUT_LOSSES: 1,
    TAKE_PROFIT: 0.85,
    ROLL_POSITION: 0.8,
    REDUCE_RISK: 0.75,
    REPLACE_WORKING_ORDER: 0.6,
    ACCEPT_ASSIGNMENT: 0.5,
    DEPLOY_IDLE_CASH: 0.4,
    HOLD_POSITION: 0.15,
  },
  defaultManagementIntentUrgency: 0.15,
  netEdgeDeclineReferencePct: 50,
  capitalAtRiskReferenceUsd: 2000,
  missingPositionHealthFactor: 0.5,
  missingRemainingOpportunityFactor: 0.5,
  tierThresholds: { critical: 75, high: 55, medium: 30 },
  reasonInclusionThreshold: 0.6,
  maxReasons: 4,
};
