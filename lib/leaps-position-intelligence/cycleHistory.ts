// lib/leaps-position-intelligence/cycleHistory.ts
//
// LEAPS-CYCLES-0001 -- the income history of a held LEAPS: every short call sold on the same stock since the LEAPS was opened, taken from the
// Trade Log's reconstruction of your broker transactions (lib/tradeLog). Pure. It reports what the transactions show and says plainly what it
// cannot know: the Trade Log looks back 12 months, and it cannot tell a short call sold against this LEAPS from a covered call sold against
// shares of the same stock, so both are included.

import type { ClosedTrade, UnmatchedClosure } from '@/lib/tradeLog/types';

export type CycleTrade = Pick<ClosedTrade,
  'id' | 'symbol' | 'strategy' | 'openDate' | 'closeDate' | 'expiry' | 'holdDays' | 'strikes' | 'creditReceived' | 'closePrice' | 'pnl' | 'pnlPct'
  | 'outcome' | 'fees' | 'closureMechanism' | 'openedQuantity' | 'closedQuantity'> & { excluded?: boolean };

export type CycleResult = 'expired' | 'assigned' | 'closed' | 'rolled' | 'partial';

export interface CycleRow {
  id: string;
  openDate: string;
  closeDate: string;
  holdDays: number;
  expiry: string;
  /** e.g. "375C" as reconstructed by the Trade Log. */
  strike: string;
  contracts: number;
  /** Total premium received, dollars. */
  credit: number;
  /** Total paid to close, dollars (0 for a call that expired). */
  costToClose: number;
  /** Net of fees, dollars. */
  pnl: number;
  pnlPct: number;
  outcome: ClosedTrade['outcome'];
  result: CycleResult;
}

export interface CycleHistory {
  rows: CycleRow[];
  totals: { count: number; credit: number; pnl: number; wins: number; avgHoldDays: number };
  /** First day the Trade Log's window covers. */
  windowFrom: string;
  /** False when the LEAPS was opened before the window starts, so earlier short calls cannot be shown. */
  coversFullHistory: boolean;
  /** Closings on this stock inside the window whose opening the Trade Log could not find (opened before the window). */
  unmatchedCount: number;
  /** Why there are no rows when the LEAPS's open date is unknown. */
  reason: 'ok' | 'no-entry-date';
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const round2 = (v: number) => Math.round(v * 100) / 100;

export function buildCycleHistory(input: {
  trades: CycleTrade[];
  unmatchedClosures: Array<Pick<UnmatchedClosure, 'underlying' | 'executedAt'>>;
  underlying: string;
  /** The LEAPS's broker open date, YYYY-MM-DD. */
  longEntryDate: string | null;
  /** First day of the Trade Log's window, YYYY-MM-DD. */
  windowFrom: string;
}): CycleHistory {
  const underlying = input.underlying.trim().toUpperCase();
  const empty = (reason: CycleHistory['reason']): CycleHistory => ({ rows: [], totals: { count: 0, credit: 0, pnl: 0, wins: 0, avgHoldDays: 0 }, windowFrom: input.windowFrom, coversFullHistory: false, unmatchedCount: 0, reason });
  if (!input.longEntryDate || !ISO_DATE.test(input.longEntryDate)) return empty('no-entry-date');
  const since = input.longEntryDate;

  const included = input.trades.filter(t =>
    t.strategy === 'SHORT_CALL' && t.symbol.trim().toUpperCase() === underlying && !t.excluded && t.openDate >= since && ISO_DATE.test(t.openDate) && ISO_DATE.test(t.closeDate));

  const rows: CycleRow[] = included.map(t => {
    const rolled = t.closureMechanism === 'CLOSED' && included.some(other => other.id !== t.id && other.openDate === t.closeDate);
    const result: CycleResult = t.closureMechanism === 'EXPIRED' ? 'expired'
      : t.closureMechanism === 'ASSIGNED' || t.closureMechanism === 'EXERCISED' ? 'assigned'
      : t.closureMechanism === 'PARTIAL_CLOSE' ? 'partial'
      : rolled ? 'rolled' : 'closed';
    return {
      id: t.id, openDate: t.openDate, closeDate: t.closeDate, holdDays: t.holdDays, expiry: t.expiry, strike: t.strikes,
      contracts: t.closedQuantity > 0 ? t.closedQuantity : t.openedQuantity,
      credit: round2(t.creditReceived), costToClose: round2(t.closePrice), pnl: round2(t.pnl), pnlPct: round2(t.pnlPct), outcome: t.outcome, result,
    };
  }).sort((a, b) => b.closeDate.localeCompare(a.closeDate) || b.openDate.localeCompare(a.openDate));

  const wins = rows.filter(r => r.pnl > 0).length;
  const unmatchedCount = input.unmatchedClosures.filter(u => u.underlying.trim().toUpperCase() === underlying && u.executedAt.slice(0, 10) >= since).length;
  return {
    rows,
    totals: {
      count: rows.length, credit: round2(rows.reduce((sum, r) => sum + r.credit, 0)), pnl: round2(rows.reduce((sum, r) => sum + r.pnl, 0)), wins,
      avgHoldDays: rows.length > 0 ? Math.round(rows.reduce((sum, r) => sum + r.holdDays, 0) / rows.length) : 0,
    },
    windowFrom: input.windowFrom,
    coversFullHistory: since >= input.windowFrom,
    unmatchedCount,
    reason: 'ok',
  };
}
