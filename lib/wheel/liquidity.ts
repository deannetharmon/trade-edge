// lib/wheel/liquidity.ts
//
// WHEEL-SYSTEM-0002 (W2) -- is a put liquid enough to trust its quote. Integer cents throughout.
//
// The bid-ask gap must be at most `maxBidAskBps` of the midpoint, and there must be at least `minOpenInterest` open
// contracts. A put with no bid to collect (bid 0) is never liquid, even with an ask. "Bid-ask" is the gap between the
// bid and the ask, not a credit spread.

export interface LiquidityLeg {
  bid: number;
  ask: number;
  openInterest: number;
}

export interface LiquidityLimits {
  maxBidAskBps: number;
  minOpenInterest: number;
}

const cents = (dollars: number) => Math.round(dollars * 100);

/** The gap as a whole percent of the midpoint (for the chip), or null when there is no usable quote. */
export function bidAskPercent(leg: LiquidityLeg): number | null {
  const bid = cents(leg.bid);
  const ask = cents(leg.ask);
  if (!(bid > 0) || !(ask >= bid)) return null;
  return Math.round((2 * (ask - bid) * 100) / (ask + bid));
}

export function isLiquid(leg: LiquidityLeg, limits: LiquidityLimits): boolean {
  const bid = cents(leg.bid);
  const ask = cents(leg.ask);
  if (!(bid > 0) || !(ask >= bid)) return false;
  if (!(leg.openInterest >= limits.minOpenInterest)) return false;
  // 2 x (ask - bid) / (ask + bid) <= maxBidAskBps / 10,000, cross-multiplied so nothing is divided.
  return 2 * (ask - bid) * 10_000 <= limits.maxBidAskBps * (ask + bid);
}
