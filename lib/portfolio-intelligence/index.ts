// lib/portfolio-intelligence/index.ts

export { evaluatePortfolioObjectives } from './evaluatePortfolioObjectives';
export { OBJECTIVE_RULE_ID } from './ruleIds';
export type { PortfolioObjectiveRuleId } from './ruleIds';

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
