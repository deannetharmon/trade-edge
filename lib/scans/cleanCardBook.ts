// lib/scans/cleanCardBook.ts
//
// CLEAN-CARD-0001 -- builds the ALLOC book from raw broker balances and positions. Pure.
// "Committed to a symbol" = long shares at the last close + cash secured by short puts (strike x 100 x contracts).
// Covered calls, spreads and long options add nothing here. Working (unfilled) orders are not counted yet.
// Fails closed: without a positive net liquidating value there is no book.

import type { AllocBook } from './cleanCard';

type Raw = Record<string, any>;
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/** OCC symbol tail: yymmdd + C|P + strike x 1000 in 8 digits. Returns the put strike or null. */
export function putStrikeFromOcc(occ: unknown): number | null {
  if (typeof occ !== 'string') return null;
  const m = /(\d{6})([CP])(\d{8})\s*$/.exec(occ);
  if (!m || m[2] !== 'P') return null;
  return parseInt(m[3], 10) / 1000;
}

export function buildAllocBook(balances: Raw | null | undefined, positions: readonly Raw[] | null | undefined): AllocBook | null {
  const netLiq = num(balances?.['net-liquidating-value']);
  if (netLiq == null || netLiq <= 0 || !positions) return null;
  const bySymbol: Record<string, number> = {};
  const add = (sym: unknown, dollars: number) => {
    if (typeof sym !== 'string' || !sym || !Number.isFinite(dollars) || dollars <= 0) return;
    bySymbol[sym] = (bySymbol[sym] ?? 0) + dollars;
  };
  for (const p of positions) {
    const type = p['instrument-type'];
    const qty = num(p['quantity']);
    if (qty == null || qty <= 0 || p['quantity-direction'] === 'Short' && type === 'Equity') continue;
    if (type === 'Equity') {
      const px = num(p['close-price']) ?? num(p['average-open-price']);
      if (px != null) add(p['symbol'] ?? p['underlying-symbol'], qty * px);
    } else if ((type === 'Equity Option' || type === 'Index Option') && p['quantity-direction'] === 'Short') {
      const strike = putStrikeFromOcc(p['symbol']);
      const mult = num(p['multiplier']) ?? 100;
      if (strike != null) add(p['underlying-symbol'], strike * mult * qty);
    }
  }
  return { netLiq, bySymbol };
}
