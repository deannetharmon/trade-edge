// lib/opportunity-engine/adapters/decisionAnalysisAdapter.ts
//
// OE-0001: normalizes an already-computed DecisionAnalysis (the existing,
// canonical per-candidate Decision Engine result -- see DR-0002 and
// lib/decision-engine) into an OpportunityCandidate. This is the primary,
// real, end-to-end-connected source adapter for this sprint: every
// DecisionAnalysis produced by lib/autopilot/decision/recommendationEngine.ts
// (and returned today by POST /api/autopilot/recommendations, which already
// converts real Screener/Hunter ScreenResult[] through
// screenResultsToAutopilotCandidates() and the full existing pipeline) can
// be adapted here without any new fetching, persistence, or recomputation.
//
// Nothing here re-derives Opportunity Score, Decision Confidence, or
// rejection status -- every one of those already exists on the supplied
// DecisionAnalysis and is carried through as-is.

import type { AutopilotStrategy } from '@/lib/autopilot/types';
import type { DecisionAnalysis } from '@/lib/decision-engine';
import type { OpportunityCandidate, OpportunityCandidateSource } from '../types';

// DecisionAnalysis.metadata.source uses a wider vocabulary than
// OpportunityCandidateSource (it also covers 'portfolio' and 'autopilot',
// which describe existing-position management and autonomous-run
// provenance rather than a new-trade-opportunity source). Those two map to
// 'manual' here -- a conservative, documented choice, not a fabrication:
// OE-0001 only ranks NEW opportunities, so a candidate whose origin isn't
// one of the four discovery sources is treated as unattributed rather than
// guessed at.
function toOpportunitySource(source: DecisionAnalysis['metadata']['source']): OpportunityCandidateSource {
  switch (source) {
    case 'screener':
      return 'screener';
    case 'repeat_trades':
      return 'repeat_trades';
    case 'portfolio':
    case 'autopilot':
    case 'manual':
    default:
      return 'manual';
  }
}

function latestLegExpiration(analysis: DecisionAnalysis): string | undefined {
  const legs = analysis.candidate?.legs ?? [];
  const expirations = legs.map((leg) => leg.expiration).filter((value): value is string => Boolean(value));
  if (!expirations.length) return undefined;
  // Latest, not first -- a multi-expiration structure (e.g. a future PMCC
  // candidate) should report the expiration furthest out, matching how
  // deriveEarningsWithinExpiration (recommendationEngine.ts) already treats
  // "latest expiration" as the candidate's true exposure horizon.
  return expirations.reduce((latest, current) => (new Date(current) > new Date(latest) ? current : latest));
}

function calculateDte(expiration: string | undefined, now: Date): number | undefined {
  if (!expiration) return undefined;
  const expiryMs = new Date(expiration).getTime();
  if (!Number.isFinite(expiryMs)) return undefined;
  return Math.max(0, Math.round((expiryMs - now.getTime()) / 86_400_000));
}

// Known-false vs. unknown, never fabricated: if the candidate simply has no
// earningsDate, earnings risk is genuinely unknown (undefined). If it does
// have one, the existing Decision Engine has already determined whether
// that date falls within the option's lifecycle -- reflected by the
// presence (or absence) of the 'earnings-risk' concern it already computed
// (see lib/decision-engine/evaluateSingleCandidate.ts's buildConcerns()).
// This reads that existing determination; it does not redo the date math.
function deriveEarningsRisk(analysis: DecisionAnalysis): boolean | undefined {
  if (!analysis.candidate?.earningsDate) return undefined;
  return (analysis.concerns ?? []).some((concern) => concern.id === 'earnings-risk');
}

// CSP and CC are the two Wheel-cycle legs in the repository's existing
// AutopilotStrategy taxonomy (see lib/autopilot/decision/riskGateEngine.ts
// and lib/autopilot/config's per-strategy goal model) -- this reflects that
// existing taxonomy directly, it is not a new suitability score.
function isWheelStrategy(strategy: AutopilotStrategy): boolean {
  return strategy === 'CSP' || strategy === 'CC';
}

export interface DecisionAnalysisAdapterOptions {
  now?: Date;
  pipelineId?: string;
}

// Returns null (rather than throwing) when the supplied analysis has no
// candidate/strategy/symbol to normalize -- e.g. a validation-failure
// DecisionAnalysis (lib/autopilot/decision/recommendationEngine.ts's
// buildValidationFailureAnalysis()) that never reached real candidate data.
// Callers should treat null as "not adaptable," not silently drop it
// without accounting for it, matching the existing pipeline's own
// "never silently dropped" convention (see CandidatePipelineResult).
export function decisionAnalysisToOpportunityCandidate(
  analysis: DecisionAnalysis,
  options: DecisionAnalysisAdapterOptions = {},
): OpportunityCandidate | null {
  const candidate = analysis.candidate;
  const strategy = analysis.subject.strategy ?? candidate?.strategy;
  const symbol = analysis.subject.symbol ?? candidate?.symbol;

  if (!candidate || !strategy || !symbol) return null;

  const now = options.now ?? new Date();
  const expiration = latestLegExpiration(analysis);

  return {
    id: analysis.subject.id,
    // CSP-WORKFLOW-0001 core-correction (BLOCKER-04) — analysis.candidate
    // is the full original AutopilotCandidate (lib/decision-engine/types.ts
    // DecisionAnalysis.candidate), which now carries screenerCandidateId
    // when it was built by screenResultsToAutopilotCandidates(). Passed
    // through unchanged, never re-derived.
    screenerCandidateId: candidate.screenerCandidateId,
    source: toOpportunitySource(analysis.metadata.source),
    symbol,
    strategy,
    expiration,
    dte: calculateDte(expiration, now),
    capitalRequired: analysis.expectedOutcome.capitalRequired ?? candidate.theoreticalMaxLoss ?? 0,
    decisionAnalysis: analysis,
    sector: candidate.sector,
    earningsRisk: deriveEarningsRisk(analysis),
    wheelSuitable: isWheelStrategy(strategy),
    navigationMetadata: {
      decisionAnalysisId: analysis.id,
      ...(options.pipelineId ? { pipelineId: options.pipelineId } : {}),
    },
  };
}

export interface DecisionAnalysisBatchAdapterResult {
  candidates: OpportunityCandidate[];
  skipped: Array<{ decisionAnalysisId: string; reason: string }>;
}

export function decisionAnalysesToOpportunityCandidates(
  analyses: DecisionAnalysis[],
  options: DecisionAnalysisAdapterOptions = {},
): DecisionAnalysisBatchAdapterResult {
  const candidates: OpportunityCandidate[] = [];
  const skipped: DecisionAnalysisBatchAdapterResult['skipped'] = [];

  for (const analysis of analyses) {
    const converted = decisionAnalysisToOpportunityCandidate(analysis, options);
    if (converted) {
      candidates.push(converted);
    } else {
      skipped.push({
        decisionAnalysisId: analysis.id,
        reason: 'Analysis has no underlying candidate (e.g. failed pipeline validation before reaching real candidate data).',
      });
    }
  }

  return { candidates, skipped };
}
