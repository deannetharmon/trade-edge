// lib/scans/ccGridTypes.ts
// CC-WHEEL-0001 S4 -- the covered-call strike grid: every call that passes the safety gates, by expiration and strike.

export interface CcGridCell {
  expiration: string;
  dte: number;
  strike: number;
  /** Absolute delta. */
  delta: number;
  bid: number;
  ask: number;
  premiumPerShare: number;
  openInterest: number;
  occSymbol: string;
  /** Strike is below the cost basis: a loss if called away. Hidden by default in the grid. */
  belowFloor: boolean;
  /** The bid/ask spread is wider than the width rule. Shown, tagged; never hidden. */
  wide: boolean;
  /** Open interest is below the preference. Shown, tagged. */
  thinOi: boolean;
  /** If called away: (strike - basis) x 100 x contracts + premium. Null when the basis is unknown. */
  calledAwayTotal: number | null;
  /** The same as a percent of the cost of the shares. */
  calledAwayPct: number | null;
  /** If not called: the premium kept, and the cost basis per share it lowers to. */
  premiumTotal: number;
  notCalledBasis: number | null;
}

export interface CcGrid {
  /** The cost basis (or entry price) the totals are measured against; null means totals are unavailable. */
  basis: number | null;
  /** max(stock price, basis), the strike floor; null when it cannot be known. */
  floor: number | null;
  stockPrice: number | null;
  contracts: number;
  expirations: Array<{ expiration: string; dte: number }>;
  cells: CcGridCell[];
  /** Calls left out of the grid, with the reason, so nothing disappears without a count. */
  left: { inTheMoney: number; unusableQuote: number; earnings: number; farOtm: number; truncated: number };
}
