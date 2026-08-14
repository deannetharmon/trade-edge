// lib/command-center/opportunityCandidateDetails.ts
//
// WA-0005 §13/§21/§27: a new, additive, presentation-only projection from
// the already-available DecisionAnalysis[] (the same array already held by
// app/screener/page.tsx's local `rawAnalyses` and by
// lib/recommendations/RecommendationService.ts's useCurrentRecommendations())
// into a decisionAnalysisId-keyed detail index the Detailed tier of
// RecommendationCard (components/opportunity-engine/BestOpportunitiesPanel.tsx)
// can look up by `rec.decisionAnalysisId`.
//
// This module does NOT touch lib/opportunity-engine or lib/decision-engine
// types, does not fetch anything, does not recompute score/confidence/
// disposition, and never fabricates a value: every optional field on
// DecisionAnalysis.candidate (an AutopilotCandidate) or its legs is copied
// through as-is, or left undefined when the source is missing. It is a
// pure projection, safe to call on every render.
//
// Field classification (CES §13, verified against lib/decision-engine/types.ts
// and lib/autopilot/types.ts):
//   - Guaranteed once this seam runs: alternatives[], reviewTriggers[],
//     expectedOutcome (object), concerns[] (with severity), rulesEvaluated[],
//     rulesBlocked[] -- all non-optional array/object fields on
//     DecisionAnalysis itself (arrays may be empty, never omitted).
//   - Optional, present only when `decisionAnalysis.candidate` (and, for
//     per-leg fields, `candidate.legs`) is populated: underlyingPrice,
//     strikes, expiration, dte (derived), credit/debit, capital requirement,
//     return measures, probability/delta, volatility context, earnings/event
//     context.

import type {
  DecisionAlternative,
  DecisionAnalysis,
  DecisionConcern,
  DecisionReviewTrigger,
  ExpectedOutcome,
} from '@/lib/decision-engine';
import type { AutopilotLeg } from '@/lib/autopilot/types';

export interface OpportunityCandidateDetailLeg {
  symbol: string;
  optionSymbol?: string;
  direction: AutopilotLeg['direction'];
  optionType?: AutopilotLeg['optionType'];
  strike?: number;
  expiration?: string;
  contractMultiplier?: number;
  openInterest?: number;
}

export interface OpportunityCandidateDetail {
  decisionAnalysisId: string;

  // Optional -- present only when decisionAnalysis.candidate is populated.
  underlyingPrice?: number;
  legs?: OpportunityCandidateDetailLeg[];
  expiration?: string;
  dte?: number;
  credit?: number;
  netDebit?: number;
  netDebitUnit?: 'per_share';
  capitalRequirement?: number;
  roc?: number;
  annualizedYield?: number;
  expectedAnnualizedReturnPct?: number;
  pop?: number;
  betaWeightedDelta?: number;
  assignmentProbabilityPct?: number;
  ivr?: number;
  earningsDate?: string;

  // Guaranteed once this seam runs -- non-optional on DecisionAnalysis
  // itself (arrays may be empty, never fabricated/omitted).
  alternatives: DecisionAlternative[];
  reviewTriggers: DecisionReviewTrigger[];
  expectedOutcome: ExpectedOutcome;
  concerns: DecisionConcern[];
  rulesEvaluated: string[];
  rulesBlocked: string[];
}

// Reused as a presentation-layer utility only -- mirrors
// lib/opportunity-engine/adapters/decisionAnalysisAdapter.ts's own
// calculateDte/latestLegExpiration logic exactly (not re-implemented as
// domain logic, not imported from that module since it is not exported by
// lib/opportunity-engine's public barrel and this seam must not reach into
// lib/opportunity-engine internals).
function latestLegExpiration(analysis: DecisionAnalysis): string | undefined {
  const legs = analysis.candidate?.legs ?? [];
  const expirations = legs.map((leg) => leg.expiration).filter((value): value is string => Boolean(value));
  if (!expirations.length) return undefined;
  return expirations.reduce((latest, current) => (new Date(current) > new Date(latest) ? current : latest));
}

function calculateDte(expiration: string | undefined, now: Date): number | undefined {
  if (!expiration) return undefined;
  const expiryMs = new Date(expiration).getTime();
  if (!Number.isFinite(expiryMs)) return undefined;
  return Math.max(0, Math.round((expiryMs - now.getTime()) / 86_400_000));
}

/**
 * Projects a single DecisionAnalysis into its OpportunityCandidateDetail.
 * Pure function -- does not mutate `analysis` or anything it references.
 */
export function buildOpportunityCandidateDetail(
  analysis: DecisionAnalysis,
  now: Date = new Date(),
): OpportunityCandidateDetail {
  const candidate = analysis.candidate;
  const expiration = latestLegExpiration(analysis);

  return {
    decisionAnalysisId: analysis.id,

    underlyingPrice: candidate?.underlyingPrice,
    legs: candidate?.legs?.map((leg) => ({
      symbol: leg.symbol,
      optionSymbol: leg.optionSymbol,
      direction: leg.direction,
      optionType: leg.optionType,
      strike: leg.strike,
      expiration: leg.expiration,
      contractMultiplier: leg.contractMultiplier,
      openInterest: leg.openInterest,
    })),
    expiration,
    dte: calculateDte(expiration, now),
    credit: candidate?.estimatedCredit ?? analysis.expectedOutcome.expectedCredit,
    netDebit: candidate?.netDebit,
    netDebitUnit: candidate?.netDebitUnit,
    capitalRequirement: analysis.expectedOutcome.capitalRequired ?? candidate?.theoreticalMaxLoss,
    roc: candidate?.roc,
    annualizedYield: candidate?.annualizedYield,
    expectedAnnualizedReturnPct: analysis.expectedOutcome.expectedAnnualizedReturnPct,
    pop: candidate?.pop,
    betaWeightedDelta: candidate?.betaWeightedDelta,
    assignmentProbabilityPct: analysis.expectedOutcome.assignmentProbabilityPct,
    ivr: candidate?.ivr,
    earningsDate: candidate?.earningsDate,

    alternatives: analysis.alternatives,
    reviewTriggers: analysis.reviewTriggers,
    expectedOutcome: analysis.expectedOutcome,
    concerns: analysis.concerns,
    rulesEvaluated: analysis.metadata.rulesEvaluated,
    rulesBlocked: analysis.metadata.rulesBlocked,
  };
}

/**
 * Projects a full DecisionAnalysis[] into a decisionAnalysisId-keyed index,
 * for RecommendationCard's Detailed tier to look up by `rec.decisionAnalysisId`.
 * Pure, no fetch, no mutation of the input array.
 */
export function buildOpportunityCandidateDetails(
  analyses: DecisionAnalysis[],
  now: Date = new Date(),
): Record<string, OpportunityCandidateDetail> {
  const index: Record<string, OpportunityCandidateDetail> = {};
  for (const analysis of analyses) {
    index[analysis.id] = buildOpportunityCandidateDetail(analysis, now);
  }
  return index;
}
