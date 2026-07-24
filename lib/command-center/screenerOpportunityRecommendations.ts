// lib/command-center/screenerOpportunityRecommendations.ts
//
// OE-0002A: pure translation between the existing /api/autopilot/
// recommendations route's JSON response shape and
// buildOpportunityRecommendations() (OE-0001's existing, unmodified adapter +
// ranker, via its existing TC-0001 wrapper). Extracted into its own module so
// the Screener page's wiring (app/screener/page.tsx) is independently
// testable without mounting that page or mocking TastyTrade auth/fetch
// end-to-end -- the same reason buildOpportunityRecommendations.ts itself was
// extracted for TC-0001.
//
// This function does no fetching and no ranking of its own: it only reads
// the already-parsed response body's `result.recommendations` (a real
// DecisionAnalysis[], or absent) and passes it straight through to the
// existing, unmodified pipeline. An empty/missing feed produces an honest
// empty result, never a fabricated one.
//
// Portfolio-neutral by design, per OE-0002A's explicit scope: no live
// capital, no exposure tracking, no account balance. See
// docs/design/OE-0002A-Opportunity-Engine-Activation.md, "Portfolio Mode
// Constraints." Real capital/exposure wiring is deferred to future work
// (OE-0002B), not decided here.

import { buildOpportunityRecommendations } from './buildOpportunityRecommendations';
import type { OpportunityRecommendation } from '@/lib/opportunity-engine';
import type { DecisionAnalysis } from '@/lib/decision-engine';

export interface RecommendationsApiResponseBody {
  success?: boolean;
  error?: string;
  result?: {
    recommendations?: DecisionAnalysis[];
  };
}

export interface ScreenerOpportunityRecommendationsResult {
  recommendations: OpportunityRecommendation[];
  generatedAt: string;
}

export function opportunityRecommendationsFromApiResponse(
  body: RecommendationsApiResponseBody,
  now: Date = new Date(),
): ScreenerOpportunityRecommendationsResult {
  const analyses: DecisionAnalysis[] = body.result?.recommendations ?? [];
  const generatedAt = now.toISOString();

  const { recommendations } = buildOpportunityRecommendations(analyses, {
    availableCapital: 0,
    generatedAt,
  });

  return { recommendations, generatedAt };
}
