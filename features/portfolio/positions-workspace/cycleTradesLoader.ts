// features/portfolio/positions-workspace/cycleTradesLoader.ts
//
// LEAPS-CYCLES-0001 -- loads the Trade Log's closed trades (last 12 months, rebuilt from your broker transactions) for the income-history
// view. Client-side, on demand only, and shared: the result is kept in memory for ten minutes and concurrent requests share one fetch, so
// several held LEAPS on the Positions screen cost one set of transaction requests, not one each. Nothing is stored beyond the page.

import { fetchAndReconstructTrades, rangeStartDate } from '@/lib/tradeLog/reconstructTrades';
import { reconstructEquityRealized, type EquityRealizedLot } from '@/lib/tradeLog/equityRealized';
import type { ClosedTrade, UnmatchedClosure } from '@/lib/tradeLog/types';

export interface LoadedClosedTrades {
  trades: ClosedTrade[];
  unmatchedClosures: UnmatchedClosure[];
  /** PNL-CAL-0002: realized P/L on shares (stocks and ETFs) from the same transactions; the Trade Log itself stays options-only. */
  equityLots: EquityRealizedLot[];
  /** Share sales or buys that could not be matched (cost basis before the window, or unreadable data); never in any total. */
  equityUnmatched: UnmatchedClosure[];
  /** First day the 12-month window covers. */
  windowFrom: string;
  /** The broker account the transactions belong to (the Trade Log covers the active account only); null if there were none. */
  accountNumber: string | null;
}

export const CYCLE_TRADES_TTL_MS = 10 * 60 * 1000;

let cached: { at: number; value: LoadedClosedTrades } | null = null;
let inflight: Promise<LoadedClosedTrades> | null = null;

export function resetCycleTradesCache(): void { cached = null; inflight = null; }

export async function loadClosedTrades(now: () => number = Date.now): Promise<LoadedClosedTrades> {
  if (cached && now() - cached.at < CYCLE_TRADES_TTL_MS) return cached.value;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { trades, unmatchedClosures, transactions } = await fetchAndReconstructTrades('12m');
      const accountNumber = transactions.find(tx => typeof tx['account-number'] === 'string')?.['account-number'] ?? null;
      const equity = reconstructEquityRealized(transactions);
      const value: LoadedClosedTrades = { trades, unmatchedClosures, equityLots: equity.lots, equityUnmatched: equity.unmatched, windowFrom: rangeStartDate('12m'), accountNumber: typeof accountNumber === 'string' ? accountNumber : null };
      cached = { at: now(), value };
      return value;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
