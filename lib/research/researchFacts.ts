// lib/research/researchFacts.ts

// RESEARCH-0002: assemble the price-structure facts for one ticker from its daily bars and the SPY bars. Pure (the clock is a parameter).
import { completedDailyCloses } from '@/lib/indicators/completedBars';
import { atr14, horizonReturns, keyLevels, openGaps, rangeExtremes, relativeStrength, volumeRatio, type FactBar, type HorizonReturns, type KeyLevels, type OpenGap, type RangeExtremes } from './techFacts';

export interface ResearchFacts {
  symbol: string;
  /** Unix seconds of the last COMPLETED daily bar the facts are built on. */
  asOf: number;
  price: number;
  atr14: number | null;
  atrPct: number | null;
  levels: KeyLevels | null;
  /** Highest high / lowest low over the last 20 and 250 completed sessions, unconfirmed by design. */
  extremes: RangeExtremes;
  /** Open daily gaps, nearest three each side of the last close. */
  gaps: OpenGap[];
  volumeRatio: number | null;
  relativeStrength: { stockPct: number; benchmarkPct: number; diffPts: number } | null;
  /** Price change over 1, 3 and 6 months (21, 63, 126 completed sessions). */
  returns: HorizonReturns;
}

/**
 * The bars without the still-forming last bar, reusing the existing completed-bars rule. Null when the input cannot be trusted:
 * the rule must keep every bar or drop exactly the last one, never anything else.
 */
export function completedBars(bars: readonly FactBar[], now: Date): FactBar[] | null {
  const closes = completedDailyCloses(bars, now);
  if (!closes) return null;
  if (closes.length === bars.length) return [...bars];
  if (closes.length === bars.length - 1) return bars.slice(0, -1);
  return null;
}

export function buildResearchFacts(symbol: string, stockBars: readonly FactBar[], spyBars: readonly FactBar[], now: Date = new Date()): ResearchFacts | null {
  const stock = completedBars(stockBars, now);
  if (!stock || stock.length === 0) return null;
  const spy = completedBars(spyBars, now);
  const last = stock[stock.length - 1];
  const atr = atr14(stock);
  return {
    symbol,
    asOf: last.t,
    price: last.c,
    atr14: atr,
    atrPct: atr != null ? (atr / last.c) * 100 : null,
    levels: keyLevels(stock),
    extremes: rangeExtremes(stock),
    gaps: openGaps(stock),
    volumeRatio: volumeRatio(stock),
    relativeStrength: spy ? relativeStrength(stock, spy) : null,
    returns: horizonReturns(stock),
  };
}
