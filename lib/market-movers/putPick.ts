// lib/market-movers/putPick.ts

import type { MarketMoversSettings, PutPick, PutQuote } from './types';

const usable = (p: PutQuote) =>
  Number.isFinite(p.strike) && p.strike > 0 && Number.isFinite(p.bid) && Number.isFinite(p.ask) && p.bid > 0 && p.ask >= p.bid && p.dte > 0;

/**
 * Picks the put to sell. Expiration = nearest the target DTE in calendar days (ties to the shorter).
 * Strike = mid credit / (strike x 100) closest to the target return (ties to the lower strike).
 * `isLiquid` is injected so the existing CSP bid/ask liquidity gate can be reused without importing scoring code here.
 */
export function pickPut(
  puts: PutQuote[],
  settings: MarketMoversSettings,
  isLiquid: (p: PutQuote) => boolean = () => true,
): PutPick | null {
  const ok = puts.filter((p) => usable(p) && isLiquid(p));
  if (ok.length === 0) return null;

  const dist = (p: PutQuote) => Math.abs(p.dte - settings.targetDte);
  const bestDist = Math.min(...ok.map(dist));
  const sameExpiry = ok.filter((p) => dist(p) === bestDist);
  const expiry = sameExpiry.reduce((a, b) => (b.dte < a.dte ? b : a)).expiration;
  const chain = ok.filter((p) => p.expiration === expiry);

  const scored = chain.map((put) => {
    const capital = put.strike * 100;
    const midCredit = (put.bid + put.ask) / 2;
    const midReturnPct = ((midCredit * 100) / capital) * 100; // credit is per share, capital per contract
    return {
      put,
      capital,
      midCredit,
      midReturnPct,
      bidReturnPct: ((put.bid * 100) / capital) * 100,
      gapToTargetPct: Math.abs(midReturnPct - settings.targetReturnPct),
    };
  });
  scored.sort((a, b) => a.gapToTargetPct - b.gapToTargetPct || a.put.strike - b.put.strike);
  return scored[0];
}

/** GTC buy-to-close limit at 50% of the premium received (rounded to the cent). */
export function exitLimitPrice(sellPrice: number): number {
  return Math.round(sellPrice * 50) / 100;
}
