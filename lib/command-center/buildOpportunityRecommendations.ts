// lib/command-center/buildOpportunityRecommendations.ts
//
// TC-0001B: wires the Command Center's Best Opportunity card through
// OE-0001's real, existing adapter and ranker -- decisionAnalysesToOpportunityCandidates()
// then rankOpportunityCandidates() -- exactly as
// docs/design/TC-0001-Trade-Command-Center.md section 3.6 requires. This
// function never fabricates a candidate: `analyses` must be a real
// DecisionAnalysis[] the caller already has (e.g. from a completed
// screener scan's POST /api/autopilot/recommendations result). No
// acquisition mechanism for that feed exists on /dashboard yet (see the
// design doc's "Known limitations") -- callers without one should pass an
// empty array, which correctly and honestly produces zero recommendations
// rather than a mocked or sample one. This is intentional, disclosed, and
// matches BestOpportunitiesPanel's own explicit contract: mount only with a
// real, already-computed feed, never with a new fetch, persistence, or
// cross-page state manufactured just to populate it.

import {
  decisionAnalysesToOpportunityCandidates,
  rankOpportunityCandidates,
} from '@/lib/opportunity-engine';
import type { OpportunityContext, OpportunityRecommendation } from '@/lib/opportunity-engine';
import type { DecisionAnalysis } from '@/lib/decision-engine';

export interface BuildOpportunityRecommendationsResult {
  recommendations: OpportunityRecommendation[];
  skipped: { decisionAnalysisId: string; reason: string }[];
}

export function buildOpportunityRecommendations(
  analyses: DecisionAnalysis[],
  context: OpportunityContext,
): BuildOpportunityRecommendationsResult {
  const { candidates, skipped } = decisionAnalysesToOpportunityCandidates(analyses);
  const recommendations = rankOpportunityCandidates(candidates, context);
  return { recommendations, skipped };
}
