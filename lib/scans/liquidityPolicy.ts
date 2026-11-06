// lib/scans/liquidityPolicy.ts

// LIQUIDITY-SYNC-0001 (Ian, Dean): ONE liquidity policy for every strategy's scan.
//  - Open interest of exactly 0 means no market exists: it is disqualified (a gate), never a warning.
//  - A preset/rule OI minimum (500 / 250 / 1000...) is advisory only: an amber chip, it never hides a trade.
//  - A "best pick" surface needs a non-POOR bid/ask spread (SPREAD-ONLY-0001: the spread, not open interest, decides fill
//    quality, which is also how Guac Tracker labels liquidity). There is no open-interest floor on picks.

/** True when the contract has any open interest at all (finite and > 0). */
export function hasOpenInterestMarket(oi: unknown): boolean {
  return typeof oi === 'number' && Number.isFinite(oi) && oi > 0;
}
