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

// PO corrective round, Finding 3: `skipped` is an already-existing,
// canonical field on this route's response (app/api/autopilot/
// recommendations/route.ts's own `skipped` output, sourced from
// lib/autopilot/decision/screenerCandidateAdapter.ts's real adapter-skip
// list -- e.g. PMCC candidates the adapter cannot convert). It was
// previously returned by the route but never read by this module or by
// app/screener/page.tsx. Adding it here is a narrow, additive,
// presentation-layer typed seam only: it does not touch
// lib/decision-engine or lib/opportunity-engine, does not change what the
// adapter itself does, and is not a new producer -- it is a new *reader* of
// data the route already emits. This is the canonical evidence for a
// genuine partial-evaluation disclosure (some of this scan's candidates
// were evaluated successfully while others were skipped) -- never a
// fabricated or heuristic signal.
export interface RecommendationsApiResponseSkippedEntry {
  symbol: string;
  strategy?: string;
  reason: string;
}

export interface RecommendationsApiResponseBody {
  success?: boolean;
  error?: string;
  result?: {
    recommendations?: DecisionAnalysis[];
  };
  skipped?: RecommendationsApiResponseSkippedEntry[];
}

export interface ScreenerOpportunityRecommendationsResult {
  recommendations: OpportunityRecommendation[];
  generatedAt: string;
  /** Finding 3: the canonical adapter-skip list, verbatim, never fabricated. Empty array when the route omits it or it is genuinely empty. */
  skipped: RecommendationsApiResponseSkippedEntry[];
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

  return { recommendations, generatedAt, skipped: body.skipped ?? [] };
}
