// lib/portfolio-intelligence/index.ts

export { evaluatePortfolioObjectives } from './evaluatePortfolioObjectives';
export { prioritizePortfolioObjectives, synthesizeWaitObjective } from './prioritizePortfolioObjectives';
export { RULE_ID_OBJECTIVE_TYPE, isRuleIdConsistentWithType } from './ruleIds';
export type { PortfolioObjectiveRuleId } from './types';

// PI-0003: the combining adapter -- Position + Portfolio + Pending Order
// objectives into one canonical ranked list. First real production wiring
// of evaluatePortfolioObjectives(), which previously had zero consumers.
export { buildPortfolioIntelligenceContext, computeCanonicalPortfolioPriorities } from './adapters/portfolioIntelligenceAdapter';
export type {
  CanonicalPortfolioPriorities,
  PortfolioFinancialSnapshot,
  RawPendingOrderLike,
} from './adapters/portfolioIntelligenceAdapter';

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
export { evaluatePositionObjective } from './objectives/positionObjective';
export type {
  PortfolioRecommendation,
  PortfolioRecommendationKind,
  PortfolioRecommendationUrgency,
  PositionObjectiveInput,
  PositionObjectiveResult,
} from './objectives/positionObjective';

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
