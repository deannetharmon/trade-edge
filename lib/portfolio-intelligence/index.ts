// lib/portfolio-intelligence/index.ts

export { evaluatePortfolioObjectives } from './evaluatePortfolioObjectives';
export { prioritizePortfolioObjectives, synthesizeWaitObjective } from './prioritizePortfolioObjectives';
export { RULE_ID_OBJECTIVE_TYPE, isRuleIdConsistentWithType } from './ruleIds';
export type { PortfolioObjectiveRuleId } from './types';

// PI-0003: the combining adapter -- Position + Portfolio + Pending Order
// objectives into one canonical ranked list. First real production wiring
// of evaluatePortfolioObjectives(), which previously had zero consumers.
// PI-0003.5: financial data now flows in through PortfolioFinancialContext
// (optional fields, "unavailable" genuinely distinct from "zero") instead
// of the always-empty snapshot PI-0003 shipped with.
export { buildPortfolioIntelligenceContext, computeCanonicalPortfolioPriorities } from './adapters/portfolioIntelligenceAdapter';
export type { CanonicalPortfolioPriorities, RawPendingOrderLike } from './adapters/portfolioIntelligenceAdapter';
export { buildPortfolioFinancialContext, toFiniteNumber, derivePositionConcentration, deriveWheelDominance } from './adapters/balancesNormalization';
export type { PortfolioFinancialContext, PositionExposureInput } from './adapters/balancesNormalization';

// PI-0004B: Actionability (first-class gating for Today's Priorities) and
// Position Strategy / Assignment Preference (Wheel-aware recommendations).
export { defaultActionabilityForPriority } from './actionability';
export { deriveAssignmentPreferenceFromIntent } from './positionStrategyDefaults';
export type { PortfolioObjectiveActionability, PositionStrategy, AssignmentPreference } from './types';

// Policies (PI-0003): explicit position-management vs portfolio-risk policy
// objects, replacing bare magic numbers scattered across the evaluators.
export { DEFAULT_PORTFOLIO_RISK_POLICY, DEFAULT_POSITION_MANAGEMENT_POLICY } from './policies';
export type { PortfolioRiskPolicy, PositionManagementPolicy } from './policies';

// TE-0006A, consolidated (PI-0002). Pure, deterministic, no React.
export { calculatePositionHealthScore } from './health/score';
export { healthGrade, healthSummary, inferHealthStrategy } from './health/rules';
export type {
  PositionHealthFactor,
  PositionHealthGrade,
  PositionHealthInput,
  PositionHealthLegInput,
  PositionHealthScore,
  PositionHealthSeverity,
  PositionHealthStrategy,
} from './health/types';

// TE-0006B, consolidated (PI-0002). Produces canonical PortfolioObjective;
// `legacyRecommendation` exists solely for the Portfolio page's existing
// UI (badges, priority list) to keep working unchanged.
export { evaluatePositionObjective, normalizePositionObjectivePct } from './objectives/positionObjective';
export type {
  PortfolioRecommendation,
  PortfolioRecommendationKind,
  PortfolioRecommendationUrgency,
  PortfolioPricingBasis,
  PortfolioPricingDecisionEvidence,
  PortfolioPricingDecisionStatus,
  PortfolioPricingFreshness,
  PositionObjectiveInput,
  PositionObjectiveResult,
} from './objectives/positionObjective';

// PI-0006B: canonical intent-selection engine -- the single selector behind
// every producer's `title`/`managementIntent` field in both
// objectives/positionObjective.ts and evaluatePortfolioObjectives.ts.
export { selectManagementIntent, MANAGEMENT_INTENT_LABEL } from './managementIntent';
export type {
  ManagementIntent,
  ManagementIntentCandidate,
  ManagementIntentConfidenceTier,
  ManagementIntentContext,
  ManagementIntentEvidence,
  ManagementIntentResult,
  ScoreContribution,
  TechnicalAlignment,
} from './managementIntent';

// PI-0008A: Remaining Opportunity Engine -- a parallel, independent metric
// (not part of the Decision Engine / selectManagementIntent()). See
// remainingOpportunity.ts's module doc.
export { calculateRemainingOpportunity } from './remainingOpportunity';
export type {
  RemainingOpportunityInput,
  RemainingOpportunityLifecycle,
  RemainingOpportunityResult,
} from './remainingOpportunity';

// PI-0008B: the one centralized table of recommendation-weighting values
// used by managementIntent.ts's scoreCandidates(). Exported so weighting is
// inspectable (and, per the Decision Engine Constitution, retunable in one
// place) without reaching into managementIntent.ts's internals.
export { DECISION_QUALITY_WEIGHTS } from './decisionQualityMatrix';
export type { DecisionQualityWeights } from './decisionQualityMatrix';

export type {
  MarketContextInput,
  MarketRegime,
  ObjectiveImpact,
  PendingOrderInput,
  PendingOrderStatus,
  PortfolioIntelligenceContext,
  PortfolioIntelligenceRiskPosture,
  PortfolioIntelligenceStrategy,
  PortfolioIntelligenceThresholds,
  PortfolioObjective,
  PortfolioObjectiveConcern,
  PortfolioObjectiveEvidence,
  PortfolioObjectivePriority,
  PortfolioObjectiveReviewTrigger,
  PortfolioObjectiveSource,
  PortfolioObjectiveStatus,
  PortfolioObjectiveSubject,
  PortfolioObjectiveSubjectType,
  PortfolioObjectiveType,
  PortfolioObjectiveUrgency,
  PortfolioPositionInput,
  PortfolioPositionLifecycle,
  PortfolioStateInput,
} from './types';
