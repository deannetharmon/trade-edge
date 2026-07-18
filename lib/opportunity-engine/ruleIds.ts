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
  // Disposition-changing: an exact symbol+strategy+expiration duplicate
  // against an existing position or an earlier candidate in the same
  // batch. Never fired for ordinary nonzero ticker/sector exposure -- see
  // tickerExposureDisclosed / sectorExposureDisclosed below for that.
  duplicateExposureDetected: 'oe_duplicate_exposure_detected',
  missingSectorDisclosure: 'oe_missing_sector_disclosure',
  missingEarningsDisclosure: 'oe_missing_earnings_disclosure',
  // Informational only -- ordinary nonzero existing ticker or sector
  // exposure, disclosed for awareness. Never changes disposition, rank, or
  // capital sequencing. A genuine concentration breach against the
  // account's own configured limits is a separate, canonical Decision
  // Engine concern (`single-ticker-concentration` / `sector-concentration`)
  // that already affects `recommendation.status` upstream -- these two
  // rule ids are not that, and do not duplicate it.
  tickerExposureDisclosed: 'oe_ticker_exposure_disclosed',
  sectorExposureDisclosed: 'oe_sector_exposure_disclosed',
  recommendedTopPick: 'oe_recommended_top_pick',
} as const;

export type OpportunityRuleId = (typeof OE_RULE_IDS)[keyof typeof OE_RULE_IDS];
