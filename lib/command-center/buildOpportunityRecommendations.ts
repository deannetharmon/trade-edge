// lib/command-center/buildOpportunityRecommendations.ts
//
// TC-0001B: wires the Command Center's Best Opportunity card through
// OE-0001's real, existing adapter and ranker -- decisionAnalysesToOpportunityCandidates()
// then rankOpportunityCandidates() -- exactly as
// docs/design/TC-0001-Trade-Command-Center.md section 3.6 requires. This
// function never fabricates a candidate: `analyses` must be a real
// DecisionAnalysis[] the caller already has.
//
// CES-0001 (OE-0002B): acquisition of that real DecisionAnalysis[] is now
// the explicit job of lib/recommendations/RecommendationService (the
// Screener publishes to it; app/dashboard/page.tsx reads from it). This
// function's own contract is unchanged by that -- it still only ranks
// whatever real analyses its caller supplies, and callers with nothing yet
// should still pass an empty array, which correctly and honestly produces
// zero recommendations rather than a mocked or sample one. This function
// itself never fetches, persists, or reaches across pages -- that boundary
// now formally belongs to the Recommendation Service, not to this wrapper
// or to BestOpportunitiesPanel's contract, though both remain true here too.

import {
  decisionAnalysesToOpportunityCandidates,
  rankOpportunityCandidates,
} from '@/lib/opportunity-engine';
import type { OpportunityCandidate, OpportunityContext, OpportunityRecommendation } from '@/lib/opportunity-engine';
import type { DecisionAnalysis } from '@/lib/decision-engine';
import { DIREXION_GATE1_BOOTSTRAP, resolveCatalogInstrumentMetadata } from '@/lib/instrument-metadata';
import { calculateLayeredOptionExposure } from '@/lib/leverage-risk';

export interface BuildOpportunityRecommendationsResult {
  recommendations: OpportunityRecommendation[];
  skipped: { decisionAnalysisId: string; reason: string }[];
}

function buildGate5NormalizedRiskEvidence(
  analyses: DecisionAnalysis[],
): ReadonlyMap<string, OpportunityCandidate['normalizedRisk']> {
  const evidence = new Map<string, OpportunityCandidate['normalizedRisk']>();

  for (const analysis of analyses) {
    const symbol = analysis.subject.symbol ?? analysis.candidate?.symbol;
    if (!symbol) continue;

    const metadata = resolveCatalogInstrumentMetadata(DIREXION_GATE1_BOOTSTRAP, symbol);
    if (!metadata) continue;

    const candidate = analysis.candidate;
    if (!candidate) continue;
    const capitalRequired = analysis.expectedOutcome.capitalRequired ?? candidate.theoreticalMaxLoss ?? 0;
    const layered = calculateLayeredOptionExposure({ candidate, metadata, capitalRequired });

    evidence.set(analysis.subject.id, {
      economicUnderlying: layered.economicUnderlying,
      normalizationAuthoritative: layered.normalizationAuthoritative,
      initialEffectiveExposure: layered.economicUnderlyingDeltaExposure,
      capitalEfficiency: layered.capitalEfficiency,
      hardRiskGatePassed: layered.normalizationAuthoritative,
      hardRiskGateReasons: layered.normalizationAuthoritative ? [] : layered.reasons,
      layeredLeverage: true,
    });
  }

  return evidence;
}

export function buildOpportunityRecommendations(
  analyses: DecisionAnalysis[],
  context: OpportunityContext,
): BuildOpportunityRecommendationsResult {
  const normalizedRiskByCandidateId = buildGate5NormalizedRiskEvidence(analyses);
  const { candidates, skipped } = decisionAnalysesToOpportunityCandidates(analyses, { normalizedRiskByCandidateId });
  const recommendations = rankOpportunityCandidates(candidates, context);
  return { recommendations, skipped };
}
