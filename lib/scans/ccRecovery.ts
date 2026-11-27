// lib/scans/ccRecovery.ts

// CHAIN-ALL-0002 (Recovery mode, step 1): the numbers behind the Recovery panel. Pure; no I/O.
//
// Recovery mode is for shares priced UNDER their cost. It is opt-in and per ticker. It lets a weekly call below cost be
// looked at, ranked by pay per day, and compared with holding and with exiting now, on the oldest lot (what FIFO delivers
// first). A weekly call here is a paid limit order to sell near strike + premium. Nothing here recommends a trade.

import type { CcAllRow } from './ccAllCalls';
import type { CcLot } from './ccLotLoss';

/** Weekly calls only: 0.15 to 0.25 delta (about a 75 to 85% chance of keeping the shares), 5 to 21 days out. */
export const CC_RECOVERY = { deltaLo: 0.15, deltaHi: 0.25, dteLo: 5, dteHi: 21, top: 3 } as const;

/** Dollars under water: for each lot priced above the stock, shares x the gap. Lots at or under the price add nothing. */
export function recoveryGap(lots: ReadonlyArray<CcLot>, price: number): number {
  return Math.round(lots.reduce((s, l) => s + (l.price > price ? l.shares * (l.price - price) : 0), 0));
}

export function oldestLot(lots: ReadonlyArray<CcLot>): CcLot | null {
  if (lots.length === 0) return null;
  return [...lots].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))[0];
}

export interface RecoveryCandidate extends CcAllRow {
  /** Pay per day: the mid premium for one contract divided by days to expiry. */
  perDay: number;
  /** What the shares sell for if called: strike + premium (per share). */
  salePrice: number;
}

/** The weekly calls worth looking at, best first: not a pick-blocker other than "below your cost". Needs a delta. */
export function recoveryCandidates(rows: ReadonlyArray<CcAllRow>): RecoveryCandidate[] {
  const out: RecoveryCandidate[] = [];
  for (const r of rows) {
    if (r.delta === null || r.mid === null || r.collect === null) continue;
    if (r.delta < CC_RECOVERY.deltaLo - 1e-9 || r.delta > CC_RECOVERY.deltaHi + 1e-9) continue;
    if (r.dte < CC_RECOVERY.dteLo || r.dte > CC_RECOVERY.dteHi) continue;
    if (r.reasons.some(x => x !== 'below_cost')) continue; // price gap, minimum pay, under the stock price, no quote
    out.push({ ...r, perDay: Math.round((r.collect / r.dte) * 100) / 100, salePrice: Math.round((r.strike + r.mid) * 100) / 100 });
  }
  return out.sort((a, b) => b.perDay - a.perDay || b.strike - a.strike).slice(0, CC_RECOVERY.top);
}

export interface RecoveryChart {
  /** Oldest lot price. All lines are the profit or loss on 100 of those shares, against that cost. */
  cost: number;
  price: number;
  strike: number;
  premium: number;
  hold: (s: number) => number;
  call: (s: number) => number;
  exitNow: number;
  /** Above this stock price holding beats the call. */
  holdBeatsCallAbove: number;
  /** Below this stock price exiting now beats the call. */
  exitBeatsCallBelow: number;
}

/** One week out, 100 shares: hold, sell the call (called above the strike), or exit now. */
export function recoveryChart(input: { cost: number; price: number; strike: number; premiumPerShare: number }): RecoveryChart {
  const { cost, price, strike, premiumPerShare: p } = input;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    cost, price, strike, premium: p,
    hold: s => Math.round((s - cost) * 100),
    call: s => Math.round((Math.min(s, strike) - cost + p) * 100),
    exitNow: Math.round((price - cost) * 100),
    holdBeatsCallAbove: r2(strike + p),
    exitBeatsCallBelow: r2(price - p),
  };
}

/** "about 1 in 4": the broker's delta as a plain chance of being called. Null without a delta. */
export function calledOneIn(delta: number | null): number | null {
  if (delta === null || !(delta > 0) || delta >= 1) return null;
  return Math.max(2, Math.round(1 / delta));
}

/** Weeks of this premium needed to cover the gap if the stock stays flat and nothing is called. Null without a premium. */
export function weeksToCover(gap: number, weeklyPremiumTotal: number): number | null {
  if (!(weeklyPremiumTotal > 0) || gap <= 0) return null;
  return Math.ceil(gap / weeklyPremiumTotal);
}
