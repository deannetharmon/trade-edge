// lib/scans/cspOrderMath.ts
//
// CSP-ORDERS-0001 -- the pure math a CSP order needs that the existing
// multi-leg spread TradeModal cannot provide correctly (its max-loss formula
// assumes a spread width, which a cash-secured put does not have). Kept
// separate and pure so it can be tested without any broker/DOM dependency,
// same convention as lib/portfolio/stockOrderBuilder.ts.

/**
 * A cash-secured put's real max loss: the full collateral committed, minus
 * the credit received. This is NOT `spreadWidth - credit` (that formula is
 * for a defined-risk spread, which a CSP is not -- confirmed with Ian,
 * 2026-09-22). If the stock goes to zero, the put holder pays the full
 * strike per contract; the premium already collected offsets that.
 */
export function computeCspMaxLoss(strike: number, creditPerContract: number, quantity: number): number {
  if (!Number.isFinite(strike) || strike <= 0) throw new Error('strike must be a positive number');
  if (!Number.isFinite(creditPerContract) || creditPerContract < 0) throw new Error('creditPerContract must be zero or positive');
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('quantity must be a positive whole number');
  return (strike * 100 - creditPerContract) * quantity;
}

/** How far out of the money the short put is, as a percent of the underlying price. Same formula as a BPS's short leg -- a CSP is economically its naked equivalent. */
export function computeCspOtmPct(underlyingPrice: number | null | undefined, strike: number): number | null {
  if (underlyingPrice == null || !Number.isFinite(underlyingPrice) || underlyingPrice <= 0) return null;
  if (!Number.isFinite(strike)) return null;
  return ((underlyingPrice - strike) / underlyingPrice) * 100;
}

export interface CspOrderLeg {
  'instrument-type': 'Equity Option' | 'Index Option';
  symbol: string;
  quantity: number;
  action: 'Sell to Open';
}

export type BuildCspOrderLegResult = { ok: true; leg: CspOrderLeg } | { ok: false; reason: string };

/**
 * The single leg a CSP order needs -- deliberately never more than one.
 * Mirrors buildOrderLegs' existing per-strategy shape in app/screener/page.tsx
 * (same instrument-type / action conventions) without depending on that
 * file, so this stays independently testable.
 */
export function buildCspOrderLeg(occSymbol: string | null | undefined, quantity: number, isIndex: boolean): BuildCspOrderLegResult {
  if (!occSymbol) return { ok: false, reason: 'OCC symbol is not available for this candidate -- rescan to populate it.' };
  if (!Number.isInteger(quantity) || quantity < 1) return { ok: false, reason: 'Quantity must be a positive whole number.' };
  return { ok: true, leg: { 'instrument-type': isIndex ? 'Index Option' : 'Equity Option', symbol: occSymbol, quantity, action: 'Sell to Open' } };
}
