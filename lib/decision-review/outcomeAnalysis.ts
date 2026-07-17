// lib/decision-review/outcomeAnalysis.ts
//
// PI-0009B: Decision Outcome Analysis, V1.
//
// Automatically evaluates a completed Decision Review once its position has
// closed, by joining three already-existing systems -- none of which have a
// direct foreign key to each other:
//   - Decision Review (lib/decision-review): positionId === Position.key,
//     the recommendation + trader action being evaluated.
//   - Position Snapshot (lib/position-snapshot): keyed by the same
//     Position.key, so its POSITION_CLOSE event is the bridge between a
//     review's positionId and a real Trade Log entry.
//   - Closed Trade (lib/tradeLog): keyed by its own reconstructed
//     `${underlying}-${openDay}-${expiry}-${closeDate}` id, matched here by
//     symbol + closeness of closeDate to the bridging snapshot's capturedAt.
//
// This module computes everything fresh, on read -- nothing here is
// persisted (per the ticket's "no new persistence model"), and nothing here
// writes back into DecisionReview.outcomeStatus/realizedPnl, which remain
// exactly what they were before this ticket: manual, trader-set fields (see
// types.ts's module doc -- "V1 never sets or infers this automatically",
// a hard constraint from PI-0008C tied to the Decision Engine Constitution).
// The fields this module produces (recommendationOutcome, recommendationAccuracy,
// explanation) are a distinct, additive, read-only analysis surfaced
// alongside the trader's own manual judgment, never in place of it. This
// also satisfies "do not change recommendations" / "do not implement
// learning" -- nothing here feeds back into selectManagementIntent(),
// evaluatePositionObjective(), or the Decision Quality Matrix.

import type { DecisionReview } from './types';
import type { PositionSnapshotStore } from '@/lib/position-snapshot';
import type { ClosedTrade } from '@/lib/tradeLog/reconstructTrades';

export type DirectionalOutcome = 'FAVORABLE' | 'UNFAVORABLE' | 'NEUTRAL';
export type DecisionOutcomeAccuracy = 'CORRECT' | 'INCORRECT' | 'INCONCLUSIVE';

export const DECISION_OUTCOME_ACCURACY_LABEL: Record<DecisionOutcomeAccuracy, string> = {
  CORRECT: 'Correct',
  INCORRECT: 'Incorrect',
  INCONCLUSIVE: 'Inconclusive',
};

export interface DecisionOutcomeAnalysis {
  matchedTradeId: string;
  realizedPnl: number;
  traderOutcome: DirectionalOutcome;
  // null only when traderAction hasn't been recorded yet -- we can still
  // report what actually happened (traderOutcome/realizedPnl), but can't say
  // whether the recommendation's own implied path was validated or not
  // without knowing whether the trader followed it.
  recommendationOutcome: DirectionalOutcome | null;
  recommendationAccuracy: DecisionOutcomeAccuracy;
  explanation: string;
}

// A Decision Review's positionId can only bridge to a ClosedTrade through
// the Position Snapshot Engine's POSITION_CLOSE event for that same key --
// neither store has a direct reference to the other's identifier space.
// Matches within this many days of the close snapshot's capturedAt, since
// the Snapshot Engine detects closure on the next page load after the fact
// (see lib/position-snapshot's documented V1 limitation), not the instant
// the trade actually closed.
const MAX_MATCH_WINDOW_DAYS = 30;

function daysBetween(isoOrDateA: string, isoOrDateB: string): number {
  const a = new Date(isoOrDateA.slice(0, 10) + 'T12:00:00Z').getTime();
  const b = new Date(isoOrDateB.slice(0, 10) + 'T12:00:00Z').getTime();
  return Math.abs(Math.round((a - b) / 86400000));
}

// Exported for reuse/testing independent of the full analysis (e.g. to show
// "matched, awaiting sufficient data" vs. "no match yet" differently).
export function findClosedTradeForReview(
  review: DecisionReview,
  snapshotStore: PositionSnapshotStore,
  closedTrades: ClosedTrade[],
): ClosedTrade | null {
  const history = snapshotStore[review.positionId];
  if (!history || history.length === 0) return null;

  const closeSnapshot = [...history].reverse().find(s => s.event === 'POSITION_CLOSE');
  if (!closeSnapshot) return null; // Snapshot Engine hasn't detected this position as closed yet

  const candidates = closedTrades.filter(t => t.symbol === closeSnapshot.symbol);
  if (candidates.length === 0) return null;

  const ranked = candidates
    .map(t => ({ trade: t, distance: daysBetween(t.closeDate, closeSnapshot.capturedAt) }))
    .sort((a, b) => a.distance - b.distance);

  const best = ranked[0];
  if (!best || best.distance > MAX_MATCH_WINDOW_DAYS) return null;
  return best.trade;
}

function directionalOutcomeFromClosedTrade(trade: ClosedTrade): DirectionalOutcome {
  if (trade.outcome === 'WIN') return 'FAVORABLE';
  if (trade.outcome === 'LOSS') return 'UNFAVORABLE';
  return 'NEUTRAL'; // SCRATCH, or the (currently unused by reconstructTrades) OPEN/UNKNOWN cases
}

function invert(outcome: DirectionalOutcome): DirectionalOutcome {
  if (outcome === 'FAVORABLE') return 'UNFAVORABLE';
  if (outcome === 'UNFAVORABLE') return 'FAVORABLE';
  return 'NEUTRAL';
}

function buildExplanation(
  review: DecisionReview,
  trade: ClosedTrade,
  followed: boolean | null,
  traderOutcome: DirectionalOutcome,
  accuracy: DecisionOutcomeAccuracy,
): string {
  const pnlStr = `${trade.pnl >= 0 ? '+' : ''}$${trade.pnl.toFixed(2)}`;
  const label = review.evidence.label;

  if (trade.reconstructionStatus === 'INCOMPLETE') {
    return `Matched to a closed trade (${pnlStr}), but its reconstruction is only a best-effort approximation (see Trade Log) -- accuracy inconclusive.`;
  }
  if (traderOutcome === 'NEUTRAL') {
    return `Trade closed roughly flat (${pnlStr}) -- too close to call whether "${label}" was the right call.`;
  }
  if (followed == null) {
    return `Trade closed ${pnlStr} (${traderOutcome.toLowerCase()}), but no trader action was recorded for this review -- can't tell whether "${label}" was followed.`;
  }
  if (followed) {
    return accuracy === 'CORRECT'
      ? `Trader followed "${label}" and the trade closed ${pnlStr} -- recommendation correct.`
      : `Trader followed "${label}" but the trade closed ${pnlStr} -- recommendation incorrect.`;
  }
  // not followed
  return accuracy === 'CORRECT'
    ? `Trader did not follow "${label}" and the trade closed ${pnlStr} -- following it would likely have avoided this outcome.`
    : `Trader did not follow "${label}" and the trade closed ${pnlStr} anyway -- ignoring it worked out better this time.`;
}

// Returns null when there isn't yet a completed trade to evaluate against
// (position not detected as closed by the Snapshot Engine, or no matching
// Closed Trade within the match window) -- i.e. "insufficient data", per the
// ticket's explicit gate. Once matched, an analysis is always produced, with
// recommendationAccuracy/recommendationOutcome falling back to INCONCLUSIVE/
// null rather than a fabricated judgment when the trader's action isn't
// known or the trade result was a scratch.
export function analyzeDecisionOutcome(
  review: DecisionReview,
  snapshotStore: PositionSnapshotStore,
  closedTrades: ClosedTrade[],
): DecisionOutcomeAnalysis | null {
  const trade = findClosedTradeForReview(review, snapshotStore, closedTrades);
  if (!trade) return null;

  const traderOutcome = directionalOutcomeFromClosedTrade(trade);
  const followed = review.traderAction == null ? null : review.traderAction === 'FOLLOWED_RECOMMENDATION';

  let recommendationOutcome: DirectionalOutcome | null = null;
  if (traderOutcome === 'NEUTRAL') {
    recommendationOutcome = 'NEUTRAL';
  } else if (followed != null) {
    recommendationOutcome = followed ? traderOutcome : invert(traderOutcome);
  }

  let accuracy: DecisionOutcomeAccuracy;
  if (trade.reconstructionStatus === 'INCOMPLETE' || recommendationOutcome == null || recommendationOutcome === 'NEUTRAL') {
    accuracy = 'INCONCLUSIVE';
  } else {
    accuracy = recommendationOutcome === 'FAVORABLE' ? 'CORRECT' : 'INCORRECT';
  }

  return {
    matchedTradeId: trade.id,
    realizedPnl: trade.pnl,
    traderOutcome,
    recommendationOutcome,
    recommendationAccuracy: accuracy,
    explanation: buildExplanation(review, trade, followed, traderOutcome, accuracy),
  };
}

// Batch helper for list views (Decision History): analyzes every review in a
// store, keeping only the ones with enough data to produce a result.
export function analyzeAllDecisionOutcomes(
  reviews: Record<string, DecisionReview>,
  snapshotStore: PositionSnapshotStore,
  closedTrades: ClosedTrade[],
): Record<string, DecisionOutcomeAnalysis> {
  const result: Record<string, DecisionOutcomeAnalysis> = {};
  for (const [id, review] of Object.entries(reviews)) {
    const analysis = analyzeDecisionOutcome(review, snapshotStore, closedTrades);
    if (analysis) result[id] = analysis;
  }
  return result;
}
