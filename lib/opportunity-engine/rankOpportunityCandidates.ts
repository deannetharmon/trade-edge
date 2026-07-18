// lib/opportunity-engine/rankOpportunityCandidates.ts
//
// OE-0001: the Opportunity Engine's comparison layer. Establishes a
// deterministic evaluation order across a supplied batch of
// already-evaluated candidates, separates disposition-changing conflicts
// from informational exposure disclosures, sequentially reserves a shared
// capital pool for accepted candidates in that order, delegates every
// per-candidate disposition decision to evaluateOpportunityCandidate(),
// and then produces a final DISPLAY order that always respects disposition
// precedence (RECOMMENDED, then ACCEPTABLE_ALTERNATIVE, then WATCH, then
// REJECTED) -- see the two-pass structure in rankOpportunityCandidates()
// below. This file owns sequencing only -- no score, confidence, or
// rejection is computed here.

import { OE_RULE_IDS } from './ruleIds';
import type { AutopilotStrategy } from '@/lib/autopilot/types';
import { evaluateOpportunityCandidate } from './evaluateOpportunityCandidate';
import type {
  OpportunityCandidate,
  OpportunityContext,
  OpportunityDisposition,
  OpportunityRecommendation,
} from './types';

// Deterministic status rank: existing Decision Engine "recommended"
// candidates are compared first, "conditional" next, and "not_recommended"
// (hard-rejected) always sort last -- their position never depends on
// score, only on the Decision Engine's own status. This is what makes
// "hard-rejected candidates remain REJECTED regardless of score" true even
// in the evaluation order, not just in the disposition mapping.
const STATUS_SORT_RANK: Record<string, number> = {
  recommended: 0,
  conditional: 1,
  not_recommended: 2,
};

function statusRank(candidate: OpportunityCandidate): number {
  return STATUS_SORT_RANK[candidate.decisionAnalysis.recommendation.status] ?? 3;
}

// Final DISPLAY precedence. This is what guarantees the corrected
// contract: a RECOMMENDED candidate always displays ahead of every
// ACCEPTABLE_ALTERNATIVE, WATCH, and REJECTED candidate, regardless of the
// evaluation-order sort below (which exists only to sequence capital and
// to decide each candidate's disposition, not to decide final display
// order).
const DISPOSITION_SORT_RANK: Record<OpportunityDisposition, number> = {
  RECOMMENDED: 0,
  ACCEPTABLE_ALTERNATIVE: 1,
  WATCH: 2,
  REJECTED: 3,
};

function exposureKey(symbol: string, strategy: AutopilotStrategy, expiration: string | undefined): string {
  return `${symbol}::${strategy}::${expiration ?? 'na'}`;
}

function formatCurrency(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

// Stable, deterministic comparator: never depends on input array order or
// on anything but the candidate's own already-computed evidence and its
// own id. Reversing the input array or re-running with the same inputs
// must always produce the same order. Used both to sequence evaluation
// (score/capital order) and, unchanged, as the within-disposition
// tie-break for final display order (see rankOpportunityCandidates()).
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

// Disposition-changing conflicts ONLY: an exact symbol+strategy+expiration
// duplicate against an existing open position, or against an earlier
// candidate already walked in this same batch. These are the only
// exposure-related facts allowed to demote a candidate below RECOMMENDED
// -- see docs/design/OE-0001-Opportunity-Engine-Foundation.md section 5.1.3.
// Deliberately does NOT look at ticker/sector exposure magnitude; see
// buildExposureDisclosures() below for that.
function detectDispositionConflicts(
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

  return conflicts;
}

// Informational-only exposure disclosures: ordinary nonzero existing
// ticker or sector exposure. These are surfaced for the trader's
// awareness but NEVER demote a candidate's disposition, and never
// contribute to rank or capital sequencing. Exposure being greater than
// zero is not, by itself, evidence of a problem -- only the account's own
// configured concentration limits determine that, and a genuine breach of
// those limits already reaches this module through the Decision Engine's
// own `single-ticker-concentration` / `sector-concentration` concerns,
// which push `recommendation.status` to `conditional` or worse upstream
// (see lib/decision-engine/evaluateSingleCandidate.ts's buildConcerns()).
// This function never re-implements or second-guesses that threshold.
function buildExposureDisclosures(
  candidate: OpportunityCandidate,
  context: OpportunityContext,
): { descriptions: string[]; ruleIds: string[] } {
  const descriptions: string[] = [];
  const ruleIds: string[] = [];

  const tickerExposure = context.existingTickerExposure?.[candidate.symbol] ?? 0;
  if (tickerExposure > 0) {
    descriptions.push(`Existing ${candidate.symbol} exposure of ${formatCurrency(tickerExposure)} is already on the books.`);
    ruleIds.push(OE_RULE_IDS.tickerExposureDisclosed);
  }

  if (candidate.sector) {
    const sectorExposure = context.existingSectorExposure?.[candidate.sector] ?? 0;
    if (sectorExposure > 0) {
      descriptions.push(`Existing ${candidate.sector} sector exposure of ${formatCurrency(sectorExposure)} is already on the books.`);
      ruleIds.push(OE_RULE_IDS.sectorExposureDisclosed);
    }
  }

  return { descriptions, ruleIds };
}

export function rankOpportunityCandidates(
  candidates: OpportunityCandidate[],
  context: OpportunityContext,
): OpportunityRecommendation[] {
  // Pass 1 -- evaluation order: sequence candidates by the Decision
  // Engine's own status/score/confidence so capital is reserved for the
  // best candidates first, and so each candidate's disposition reflects
  // what was actually still available when its turn came.
  const evaluationOrder = [...candidates].sort(compareCandidates);

  let capitalRemaining = context.availableCapital;
  const keysSeenSoFar = new Set<string>();
  const evaluated: Array<{ candidate: OpportunityCandidate; recommendation: Omit<OpportunityRecommendation, 'rank'> }> = [];

  evaluationOrder.forEach((candidate) => {
    const conflictDescriptions = detectDispositionConflicts(candidate, context, keysSeenSoFar);
    const exposureDisclosures = buildExposureDisclosures(candidate, context);

    const { recommendation, capitalConsumed } = evaluateOpportunityCandidate({
      candidate,
      context,
      capitalRemainingBeforeThisCandidate: capitalRemaining,
      conflictDescriptions,
      exposureDisclosures,
    });

    capitalRemaining -= capitalConsumed;
    keysSeenSoFar.add(exposureKey(candidate.symbol, candidate.strategy, candidate.expiration));

    evaluated.push({ candidate, recommendation });
  });

  // Pass 2 -- final display order: disposition precedence first (a
  // RECOMMENDED candidate always displays ahead of every
  // ACCEPTABLE_ALTERNATIVE, WATCH, and REJECTED candidate), then the same
  // deterministic tie-break used for evaluation order within each
  // disposition group. This is intentionally a separate pass from
  // evaluation order above: a candidate's evaluation-order position
  // (used only to sequence capital) and its final disposition can differ
  // (e.g. a high-score candidate demoted to ACCEPTABLE_ALTERNATIVE by a
  // duplicate-exposure conflict), and only the final disposition may
  // determine display order.
  const displayOrder = [...evaluated].sort((a, b) => {
    const dispositionDelta =
      DISPOSITION_SORT_RANK[a.recommendation.disposition] - DISPOSITION_SORT_RANK[b.recommendation.disposition];
    if (dispositionDelta !== 0) return dispositionDelta;
    return compareCandidates(a.candidate, b.candidate);
  });

  return displayOrder.map((item, index) => ({
    ...item.recommendation,
    rank: index + 1,
  }));
}
