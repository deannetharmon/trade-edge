// lib/wheel/planPut.ts
//
// WHEEL-SYSTEM-0001 (W1) -- which put the plan prices, and what state each ladder row is in.
//
// Put rule (Dean, 2026-09-26: "the best paying put available between the delta of 25 and 30"): among the expirations
// already fetched inside the DTE window, the put whose absolute delta is inside the band [minBps, maxBps] (inclusive)
// with the highest Annual ROC at the bid. Ties go to the lower delta (the safer put), then the nearer expiry, then the
// lower strike. A leg with no delta, a dead quote (bid 0 and ask 0), no bid to collect, or under one day left is skipped.
// W1 applies no open-interest or bid-ask filter (W2 owns filters).
//
// A failed greeks batch must never look like "no put found" (Quinn): the row says "chain error".

import type { WheelChainLeg, WheelChainResult } from './chainSearch';
import { annualizedRocBps } from './capitalPlan';
import { currentNewYorkDate, daysUntilNy } from '@/lib/scans/earningsPrecheck';
import { isLiquid, type LiquidityLimits } from './liquidity';

export interface DeltaBand {
  minBps: number;
  maxBps: number;
}

export interface PlanPut {
  leg: WheelChainLeg;
  expirationDate: string;
  /** Absolute delta in basis points. */
  deltaBps: number;
  /** Calendar days to expiry, New York basis. */
  dte: number;
  /** Annual ROC at the bid in basis points, before fees. */
  rocBps: number;
}

export interface SelectOptions {
  /** Opening fee per contract in cents, taken off the credit in the return (default 0). */
  openFeeCents?: number;
  /**
   * When given, only puts that pass the liquidity check compete (Dean: don't chase premium; a high credit on a thin quote
   * must not win). If none pass, the best of the rest is returned so the row can say "illiquid" instead of "no put".
   */
  liquidity?: LiquidityLimits;
  /** Only expirations strictly before this date (YYYY-MM-DD) compete (the shorter-expiry search). */
  beforeDate?: string;
}

const better = (a: PlanPut, best: PlanPut | null): boolean =>
  best === null ||
  a.rocBps > best.rocBps ||
  (a.rocBps === best.rocBps &&
    (a.deltaBps < best.deltaBps || (a.deltaBps === best.deltaBps && (a.dte < best.dte || (a.dte === best.dte && a.leg.strikePrice < best.leg.strikePrice)))));

export function selectPlanPut(chain: WheelChainResult, band: DeltaBand, today: string = currentNewYorkDate(), options: SelectOptions = {}): PlanPut | null {
  let best: PlanPut | null = null;
  let bestLiquid: PlanPut | null = null;
  for (const expirationDate of chain.expirations) {
    if (options.beforeDate && !(expirationDate < options.beforeDate)) continue;
    const dte = daysUntilNy(expirationDate, today);
    if (dte == null || dte < 1) continue;
    for (const leg of chain.chains[expirationDate] ?? []) {
      if (leg.optionType !== 'P') continue;
      if (leg.delta == null || !Number.isFinite(leg.delta)) continue;
      if (leg.bid === 0 && leg.ask === 0) continue;
      const deltaBps = Math.round(Math.abs(leg.delta) * 10_000);
      if (deltaBps < band.minBps || deltaBps > band.maxBps) continue;
      const rocBps = annualizedRocBps(leg.bid, leg.strikePrice, dte, options.openFeeCents ?? 0);
      if (rocBps == null) continue;
      const candidate: PlanPut = { leg, expirationDate, deltaBps, dte, rocBps };
      if (better(candidate, best)) best = candidate;
      if (options.liquidity && isLiquid(leg, options.liquidity) && better(candidate, bestLiquid)) bestLiquid = candidate;
    }
  }
  return options.liquidity ? bestLiquid ?? best : best;
}

export type FetchOutcome = {
  quote: number | null;
  chain: WheelChainResult | null;
  /** Set when the chain fetch threw. */
  chainError: string | null;
  /** The broker's own ETF-or-stock classification, when it could be read. */
  kind?: 'etf' | 'stock' | null;
};

export type RowStatus =
  | { kind: 'ok'; put: PlanPut }
  | { kind: 'chain-error'; message: string }
  | { kind: 'quote-unavailable' }
  | { kind: 'no-put' };

/** Turns raw fetch results into one honest row state. Chain trouble outranks everything else. */
export function classifyRow(outcome: FetchOutcome, band: DeltaBand, today?: string, options?: SelectOptions): RowStatus {
  if (outcome.chainError) return { kind: 'chain-error', message: outcome.chainError };
  if (!outcome.chain) return { kind: 'chain-error', message: 'No option chain was returned.' };
  const put = selectPlanPut(outcome.chain, band, today, options);
  if (put) return { kind: 'ok', put };
  if ((outcome.chain.failedBatches ?? 0) > 0) {
    return { kind: 'chain-error', message: 'Some option quotes failed to load, so no put could be chosen. Retry.' };
  }
  if (outcome.quote == null) return { kind: 'quote-unavailable' };
  return { kind: 'no-put' };
}
