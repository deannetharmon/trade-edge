// lib/research/researchFacts.ts

// RESEARCH-0002: assemble the price-structure facts for one ticker from its daily bars and the SPY bars. Pure (the clock is a parameter).
import { completedDailyCloses } from '@/lib/indicators/completedBars';
import { atr14, keyLevels, relativeStrength, volumeRatio, type FactBar, type KeyLevels } from './techFacts';

export interface ResearchFacts {
  symbol: string;
  /** Unix seconds of the last COMPLETED daily bar the facts are built on. */
  asOf: number;
  price: number;
  atr14: number | null;
  atrPct: number | null;
  levels: KeyLevels | null;
  volumeRatio: number | null;
  relativeStrength: { stockPct: number; benchmarkPct: number; diffPts: number } | null;
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
    volumeRatio: volumeRatio(stock),
    relativeStrength: spy ? relativeStrength(stock, spy) : null,
  };
}
