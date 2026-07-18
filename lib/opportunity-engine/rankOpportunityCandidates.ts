// lib/opportunity-engine/rankOpportunityCandidates.ts
//
// OE-0001: the Opportunity Engine's comparison layer. Establishes a
// deterministic sort order across a supplied batch of already-evaluated
// candidates, detects known conflicting exposure (exact symbol+strategy+
// expiration duplicates and known ticker/sector exposure), sequentially
// reserves a shared capital pool for accepted candidates in rank order, and
// delegates every per-candidate disposition decision to
// evaluateOpportunityCandidate(). This file owns sequencing only -- no
// score, confidence, or rejection is computed here.

import type { AutopilotStrategy } from '@/lib/autopilot/types';
import { evaluateOpportunityCandidate } from './evaluateOpportunityCandidate';
import type { OpportunityCandidate, OpportunityContext, OpportunityRecommendation } from './types';

// Deterministic status rank: existing Decision Engine "recommended"
// candidates are compared first, "conditional" next, and "not_recommended"
// (hard-rejected) always sort last -- their position never depends on
// score, only on the Decision Engine's own status. This is what makes
// "hard-rejected candidates remain REJECTED regardless of score" true even
// in the sort order, not just in the disposition mapping.
const STATUS_SORT_RANK: Record<string, number> = {
  recommended: 0,
  conditional: 1,
  not_recommended: 2,
};

function statusRank(candidate: OpportunityCandidate): number {
  return STATUS_SORT_RANK[candidate.decisionAnalysis.recommendation.status] ?? 3;
}

function exposureKey(symbol: string, strategy: AutopilotStrategy, expiration: string | undefined): string {
  return `${symbol}::${strategy}::${expiration ?? 'na'}`;
}

function formatCurrency(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

// Stable, deterministic comparator: never depends on input array order or
// on anything but the candidate's own already-computed evidence and its
// own id. Reversing the input array or re-running with the same inputs
// must always produce the same order.
function compareCandidates(a: OpportunityCandidate, b: OpportunityCandidate): number {
  const statusDelta = statusRank(a) - statusRank(b);
  if (statusDelta !== 0) return statusDelta;

  const scoreA = a.decisionAnalysis.opportunityScore?.total ?? -1;
  const scoreB = b.decisionAnalysis.opportunityScore?.total ?? -1;
  if (scoreB !== scoreA) return scoreB - scoreA;

  const confidenceA = a.decisionAnalysis.confidence.overall;
  const confidenceB = b.decisionAnalysis.confidence.overall;
  if (confidenceB !== confidenceA) return confidenceB - confidenceA;

  // Final, always-available tie-breaker: stable string comparison of the
  // candidate's own id. Never dependent on array position or timing.
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

// Detects every known conflicting-exposure signal for one candidate against
// the supplied context and whatever earlier-ranked candidates in this same
// batch have already been walked. Returns human-readable descriptions;
// an empty array means no known conflict -- never fabricated when data is
// simply absent.
function detectExposureConflicts(
  candidate: OpportunityCandidate,
  context: OpportunityContext,
  keysSeenSoFarInBatch: ReadonlySet<string>,
): string[] {
  const conflicts: string[] = [];
  const key = exposureKey(candidate.symbol, candidate.strategy, candidate.expiration);

  if (context.existingOpenPositionKeys?.includes(key)) {
    conflicts.push(
      `An existing open position already matches ${candidate.symbol} ${candidate.strategy}${candidate.expiration ? ` exp ${candidate.expiration}` : ''}.`,
    );
  }

  if (keysSeenSoFarInBatch.has(key)) {
    conflicts.push(
      `Another higher-ranked candidate in this batch already proposes ${candidate.symbol} ${candidate.strategy}${candidate.expiration ? ` exp ${candidate.expiration}` : ''}.`,
    );
  }

  const tickerExposure = context.existingTickerExposure?.[candidate.symbol] ?? 0;
  if (tickerExposure > 0) {
    conflicts.push(`Existing ${candidate.symbol} exposure of ${formatCurrency(tickerExposure)} is already on the books.`);
  }

  if (candidate.sector) {
    const sectorExposure = context.existingSectorExposure?.[candidate.sector] ?? 0;
    if (sectorExposure > 0) {
      conflicts.push(`Existing ${candidate.sector} sector exposure of ${formatCurrency(sectorExposure)} is already on the books.`);
    }
  }

  return conflicts;
}

export function rankOpportunityCandidates(
  candidates: OpportunityCandidate[],
  context: OpportunityContext,
): OpportunityRecommendation[] {
  const sorted = [...candidates].sort(compareCandidates);

  let capitalRemaining = context.availableCapital;
  const keysSeenSoFar = new Set<string>();
  const results: OpportunityRecommendation[] = [];

  sorted.forEach((candidate, index) => {
    const conflictDescriptions = detectExposureConflicts(candidate, context, keysSeenSoFar);

    const { recommendation, capitalConsumed } = evaluateOpportunityCandidate({
      candidate,
      context,
      capitalRemainingBeforeThisCandidate: capitalRemaining,
      conflictDescriptions,
    });

    capitalRemaining -= capitalConsumed;
    keysSeenSoFar.add(exposureKey(candidate.symbol, candidate.strategy, candidate.expiration));

    results.push({
      ...recommendation,
      rank: index + 1,
    });
  });

  return results;
}
