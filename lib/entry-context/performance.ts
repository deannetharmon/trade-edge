import type { ClosedTrade } from '@/lib/tradeLog/types';
import type { CreditSpreadEntrySnapshot } from './types';

export interface EntryPerformanceRollup {
  eligibleTrades: number;
  missingSnapshotTrades: number;
  incompleteReconstructionTrades: number;
  realizedPnl: number;
  winRate: number | null;
  insideExpectedMove: { count: number; realizedPnl: number };
  outsideExpectedMove: { count: number; realizedPnl: number };
}

export function buildEntryPerformanceRollup(
  trades: ClosedTrade[],
  snapshots: CreditSpreadEntrySnapshot[],
): EntryPerformanceRollup {
  const byTransaction = new Map<string, CreditSpreadEntrySnapshot>();
  snapshots.forEach(snapshot => snapshot.sourceTransactionIds.forEach(id => byTransaction.set(id, snapshot)));
  const rollup: EntryPerformanceRollup = {
    eligibleTrades: 0, missingSnapshotTrades: 0, incompleteReconstructionTrades: 0, realizedPnl: 0, winRate: null,
    insideExpectedMove: { count: 0, realizedPnl: 0 }, outsideExpectedMove: { count: 0, realizedPnl: 0 },
  };
  let wins = 0;
  for (const trade of trades) {
    if (trade.reconstructionStatus !== 'COMPLETE') { rollup.incompleteReconstructionTrades++; continue; }
    // A multi-leg snapshot is eligible only when every opening transaction it
    // preserves belongs to this canonical closed trade. One overlapping leg is
    // not sufficient evidence to attribute the trade to that entry snapshot.
    const candidates = new Map<string, CreditSpreadEntrySnapshot>();
    trade.sourceTransactionIds.map(id => byTransaction.get(id)).forEach(value => {
      if (value) candidates.set(value.entrySnapshotId, value);
    });
    const snapshot = Array.from(candidates.values())
      .find(candidate => candidate.sourceTransactionIds.every(id => trade.sourceTransactionIds.includes(id)));
    if (!snapshot) { rollup.missingSnapshotTrades++; continue; }
    rollup.eligibleTrades++; rollup.realizedPnl += trade.pnl;
    if (trade.outcome === 'WIN') wins++;
    const bucket = snapshot.analysis.expectedMoveState === 'INSIDE' ? rollup.insideExpectedMove : rollup.outsideExpectedMove;
    if (snapshot.analysis.expectedMoveState !== 'UNAVAILABLE') { bucket.count++; bucket.realizedPnl += trade.pnl; }
  }
  rollup.winRate = rollup.eligibleTrades === 0 ? null : wins / rollup.eligibleTrades;
  return rollup;
}
