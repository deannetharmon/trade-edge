// features/portfolio/recommendations/recommendation-types.ts
//
// PI-0002: TE-0006B (Portfolio Recommendation Rules) was consolidated into
// lib/portfolio-intelligence/objectives/positionObjective.ts, which now
// produces canonical PortfolioObjective[] rather than an independent
// recommendation model. PortfolioRecommendation is preserved here as a
// compatibility re-export ONLY -- it is the presentation-layer shape that
// PositionRecommendationBadge, DailyPriorityList, and the priorities engine
// already expect, not a second source of business logic. New code should
// prefer PortfolioObjective from '@/lib/portfolio-intelligence'.

export type {
  PortfolioRecommendation,
  PortfolioRecommendationKind,
  PortfolioRecommendationUrgency,
  PositionObjectiveInput as PortfolioRecommendationInput,
} from '@/lib/portfolio-intelligence/objectives/positionObjective';
