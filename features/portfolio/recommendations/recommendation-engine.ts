// features/portfolio/recommendations/recommendation-engine.ts
//
// PI-0002: TE-0006B consolidated into
// lib/portfolio-intelligence/objectives/positionObjective.ts. This function
// is now a thin wrapper that calls the canonical evaluator and returns only
// the legacy-shaped recommendation, for existing callers (Portfolio page)
// that haven't migrated to consuming the canonical PortfolioObjective yet.
// No decision logic lives here anymore.

import { evaluatePositionObjective } from '@/lib/portfolio-intelligence/objectives/positionObjective';
import type { PortfolioRecommendation, PortfolioRecommendationInput } from './recommendation-types';

export function calculatePortfolioRecommendation(
  input: PortfolioRecommendationInput,
  now: Date = new Date(),
): PortfolioRecommendation {
  return evaluatePositionObjective(input, now).legacyRecommendation;
}
