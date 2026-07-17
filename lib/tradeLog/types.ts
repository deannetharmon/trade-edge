// lib/tradeLog/types.ts
//
// PI-0008E: Closed Trade Integrity. Shared types for the Trade Log
// reconstruction pipeline, used by both app/trade-log/page.tsx and
// app/performance/page.tsx (which previously each held their own
// independently-drifted copy of these types -- see PI-0008D's audit).

import type { ExitType } from '@/lib/classifyExit';

export type TimeRange = '1w' | '2w' | '1m' | '3m' | '6m' | '12m';

// 'UNKNOWN' added in PI-0008E for completeness/symmetry with ExitType, but is
// not currently produced by reconstructTrades() -- every reconstructed trade
// (including partial closes, assignments, and exercises) computes a real
// WIN/LOSS/SCRATCH from its own fully-allocated P&L. Transactions that truly
// cannot be tied to any trade at all are reported separately as
// UnmatchedClosure entries rather than forced into a ClosedTrade with this
// outcome.
export type Outcome = 'WIN' | 'LOSS' | 'SCRATCH' | 'OPEN' | 'UNKNOWN';

// PI-0008E: how a position's reported closed quantity actually reached the
// state described by this row. 'CLOSED' is the pre-PI-0008E-equivalent case
// (a full, single closing trade) and produces byte-identical numbers to the
// old per-page implementations.
export type ClosureMechanism = 'CLOSED' | 'PARTIAL_CLOSE' | 'ASSIGNED' | 'EXERCISED' | 'EXPIRED';

// PI-0008E: whether this row's fields came from a clean 1:1 reconstruction
// ('COMPLETE') or a best-effort approximation ('INCOMPLETE' -- e.g. the legs
// of a nominal multi-leg spread closed in different quantities within the
// same tranche, or a source transaction was missing usable price/fee data).
// This is metadata for future reconciliation; existing consumers that never
// read this field see the same pnl/credit/fees numbers as before.
export type ReconstructionStatus = 'COMPLETE' | 'INCOMPLETE';

export interface ClosedTrade {
  id: string;
  symbol: string;
  strategy: 'BPS' | 'BCS' | 'IC' | 'SPREAD' | 'OTHER';
  openDate: string;
  closeDate: string;
  openTime: string;   // HH:MM local (ET)
  openDow: number;    // 0=Sun..6=Sat
  expiry: string;
  holdDays: number;
  strikes: string;
  creditReceived: number;
  closePrice: number;
  pnl: number;
  pnlPct: number;
  outcome: Outcome;
  quantity: number;
  fees: number;
  excluded?: boolean; // user-toggled: excluded from reporting
  dteAtClose: number;
  dteAtEntry: number;
  exitType: ExitType;

  // PI-0008E reconstruction metadata -- for future reconciliation. Not
  // rendered in the UI beyond what's needed to avoid misleading aggregates.
  reconstructionStatus: ReconstructionStatus;
  closureMechanism: ClosureMechanism;
  openedQuantity: number;    // original contract count of the opening lot(s)
  closedQuantity: number;    // contracts this row accounts for closing
  remainingQuantity: number; // contracts still open after this row, if any
  sourceTransactionIds: string[];
}

export interface CacheEntry {
  trades: ClosedTrade[];
  fetchedAt: number;
  deviceId: string;
  range: TimeRange;
  version: string;
}

// PI-0008E: a closing/assignment/exercise/expiration transaction that could
// not be matched to any known open lot within the fetched window (most
// commonly because the position was opened before the lookback start date).
// Previously these were silently dropped with no trace. They are never
// fabricated into a ClosedTrade -- there is no entry-side data to build one
// from -- but they are surfaced here so callers know Trade Log's totals for
// this period are known-incomplete rather than silently wrong.
export interface UnmatchedClosure {
  symbol: string;
  underlying: string;
  executedAt: string;
  quantity: number;
  transactionId: string;
  reason: string;
}

export interface ReconstructionResult {
  trades: ClosedTrade[];
  unmatchedClosures: UnmatchedClosure[];
}
