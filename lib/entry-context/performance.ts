import type { ClosedTrade } from '@/lib/tradeLog/types';
import type { CreditSpreadEntrySnapshot, IronCondorEntrySnapshot } from './types';

type EntrySnapshot = CreditSpreadEntrySnapshot | IronCondorEntrySnapshot;

export interface EntryPerformanceRollup {
  eligibleTrades: number;
  missingSnapshotTrades: number;
  incompleteReconstructionTrades: number;
  realizedPnl: number;
  winRate: number | null;
  insideExpectedMove: { count: number; realizedPnl: number };
  outsideExpectedMove: { count: number; realizedPnl: number };
  // TRADE-ENTRY-SNAPSHOT-0001 -- one bucket pair per score dimension
  // (positive contribution vs. zero-or-negative), same binary-split shape
  // as the existing expected-move breakdown above, for Sam's redundancy
  // analysis: if two dimensions' positive/negative buckets track the same
  // trades and the same outcomes, that's the signature of redundancy.
  byScoreDimension: Record<
    'momentum' | 'ivr' | 'emClearance' | 'range' | 'technical' | 'liquidity' | 'buffer' | 'strategyAlignment' | 'deltaQuality',
    { positive: { count: number; realizedPnl: number; wins: number }; nonPositive: { count: number; realizedPnl: number; wins: number } }
  >;
  // Ian's plan-adherence breakdown, derived from the existing ExitType
  // classification rather than a new plan-vs-actual computation:
  // TARGET_HIT/MAX_LOSS mean the plan actually played out; SCRATCH_WIN/
  // MANAGED_LOSS/FAST_CUT/TIME_STOP mean an early, discretionary exit;
  // HELD_TO_EXPIRY is neither.
  planFollowedThrough: { count: number; realizedPnl: number; wins: number };
  earlyOverride: { count: number; realizedPnl: number; wins: number };
  heldToExpiry: { count: number; realizedPnl: number; wins: number };
}

const SCORE_DIMENSIONS = [
  'momentum', 'ivr', 'emClearance', 'range', 'technical', 'liquidity', 'buffer', 'strategyAlignment', 'deltaQuality',
] as const;

const scoreFieldFor: Record<(typeof SCORE_DIMENSIONS)[number], keyof EntrySnapshot> = {
  momentum: 'scoreMomentum', ivr: 'scoreIvr', emClearance: 'scoreEmClearance', range: 'scoreRange',
  technical: 'scoreTechnical', liquidity: 'scoreLiquidity', buffer: 'scoreBuffer',
  strategyAlignment: 'scoreStrategyAlignment', deltaQuality: 'scoreDeltaQuality',
};

const EARLY_OVERRIDE_EXIT_TYPES = new Set(['SCRATCH_WIN', 'MANAGED_LOSS', 'FAST_CUT', 'TIME_STOP']);
const PLAN_FOLLOWED_EXIT_TYPES = new Set(['TARGET_HIT', 'MAX_LOSS']);

function emptyBucket() { return { count: 0, realizedPnl: 0, wins: 0 }; }

// TRADE-ENTRY-SNAPSHOT-0001 -- shared matching rule, extracted so the
// trade log's row indicator and full-detail export use the exact same
// attribution logic as the rollup above, not a separately-maintained
// copy. A multi-leg snapshot is eligible only when every opening
// transaction it preserves belongs to this canonical closed trade -- one
// overlapping leg is not sufficient evidence.
export function findSnapshotForTrade(trade: ClosedTrade, byTransaction: Map<string, EntrySnapshot>): EntrySnapshot | null {
  const candidates = new Map<string, EntrySnapshot>();
  trade.sourceTransactionIds.map(id => byTransaction.get(id)).forEach(value => {
    if (value) candidates.set(value.entrySnapshotId, value);
  });
  return Array.from(candidates.values())
    .find(candidate => candidate.sourceTransactionIds.every(id => trade.sourceTransactionIds.includes(id))) ?? null;
}

export function buildSnapshotIndex(snapshots: EntrySnapshot[]): Map<string, EntrySnapshot> {
  const byTransaction = new Map<string, EntrySnapshot>();
  snapshots.forEach(snapshot => snapshot.sourceTransactionIds.forEach(id => byTransaction.set(id, snapshot)));
  return byTransaction;
}

export function buildEntryPerformanceRollup(
  trades: ClosedTrade[],
  snapshots: EntrySnapshot[],
): EntryPerformanceRollup {
  const byTransaction = buildSnapshotIndex(snapshots);
  const rollup: EntryPerformanceRollup = {
    eligibleTrades: 0, missingSnapshotTrades: 0, incompleteReconstructionTrades: 0, realizedPnl: 0, winRate: null,
    insideExpectedMove: { count: 0, realizedPnl: 0 }, outsideExpectedMove: { count: 0, realizedPnl: 0 },
    byScoreDimension: Object.fromEntries(SCORE_DIMENSIONS.map(d => [d, { positive: emptyBucket(), nonPositive: emptyBucket() }])) as EntryPerformanceRollup['byScoreDimension'],
    planFollowedThrough: emptyBucket(), earlyOverride: emptyBucket(), heldToExpiry: emptyBucket(),
  };
  let wins = 0;
  for (const trade of trades) {
    if (trade.reconstructionStatus !== 'COMPLETE') { rollup.incompleteReconstructionTrades++; continue; }
    const snapshot = findSnapshotForTrade(trade, byTransaction);
    if (!snapshot) { rollup.missingSnapshotTrades++; continue; }
    rollup.eligibleTrades++; rollup.realizedPnl += trade.pnl;
    const isWin = trade.outcome === 'WIN';
    if (isWin) wins++;

    const emBucket = snapshot.analysis.expectedMoveState === 'INSIDE' ? rollup.insideExpectedMove : rollup.outsideExpectedMove;
    if (snapshot.analysis.expectedMoveState !== 'UNAVAILABLE') { emBucket.count++; emBucket.realizedPnl += trade.pnl; }

    for (const dim of SCORE_DIMENSIONS) {
      const evidence = snapshot[scoreFieldFor[dim]] as { state: string; value: number | null };
      if (evidence.state !== 'AVAILABLE' || evidence.value == null) continue;
      const bucket = evidence.value > 0 ? rollup.byScoreDimension[dim].positive : rollup.byScoreDimension[dim].nonPositive;
      bucket.count++; bucket.realizedPnl += trade.pnl; if (isWin) bucket.wins++;
    }

    const planBucket = PLAN_FOLLOWED_EXIT_TYPES.has(trade.exitType) ? rollup.planFollowedThrough
      : EARLY_OVERRIDE_EXIT_TYPES.has(trade.exitType) ? rollup.earlyOverride
      : trade.exitType === 'HELD_TO_EXPIRY' ? rollup.heldToExpiry
      : null;
    if (planBucket) { planBucket.count++; planBucket.realizedPnl += trade.pnl; if (isWin) planBucket.wins++; }
  }
  rollup.winRate = rollup.eligibleTrades === 0 ? null : wins / rollup.eligibleTrades;
  return rollup;
}
