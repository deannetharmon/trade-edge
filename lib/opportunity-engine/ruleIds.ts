// lib/opportunity-engine/ruleIds.ts
//
// OE-0001: centralized, named identifiers for the small set of comparison
// rules this module itself owns (as opposed to rules already evaluated by
// the existing Decision Engine, whose rule ids are read from
// decisionAnalysis.metadata.rulesEvaluated/rulesBlocked and each
// DecisionConcern's own id). Named and centralized per the sprint's "if a
// small comparison rule is necessary, centralize it, name it, document it,
// and test it."

export const OE_RULE_IDS = {
  hardRejectedByDecisionEngine: 'oe_hard_rejected_by_decision_engine',
  conditionalByDecisionEngine: 'oe_conditional_by_decision_engine',
  insufficientTotalCapital: 'oe_insufficient_total_capital',
  capitalConsumedByHigherRanked: 'oe_capital_consumed_by_higher_ranked',
  duplicateExposureDetected: 'oe_duplicate_exposure_detected',
  missingSectorDisclosure: 'oe_missing_sector_disclosure',
  missingEarningsDisclosure: 'oe_missing_earnings_disclosure',
  recommendedTopPick: 'oe_recommended_top_pick',
} as const;

export type OpportunityRuleId = (typeof OE_RULE_IDS)[keyof typeof OE_RULE_IDS];
