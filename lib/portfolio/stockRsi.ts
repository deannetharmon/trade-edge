// lib/portfolio/stockRsi.ts

// STOCK-RSI-0001 slice A -- the daily RSI shown on a held-stock card. Pure; the clock is a parameter.
// Same pipeline as the scan cards (completed daily bars -> Wilder RSI(14)), so the same ticker shows the same number
// everywhere. Display only: nothing here feeds a verdict, a score or an order gate.

import { completedDailyCloses } from '@/lib/indicators/completedBars';
import { rsiSeries } from '@/lib/indicators/rsi';

export type StockRsiDirection = 'up' | 'down' | 'flat';

export interface StockRsi {
  /** RSI on the latest completed daily bar (unrounded). */
  rsi: number;
  /** RSI on the bar before it (unrounded). */
  previous: number;
  direction: StockRsiDirection;
}

/** A move smaller than this many RSI points reads as flat, so noise does not flip the arrow. */
export const STOCK_RSI_FLAT_BAND = 1;

export function stockRsiDirection(rsi: number, previous: number): StockRsiDirection {
  const move = rsi - previous;
  if (Math.abs(move) < STOCK_RSI_FLAT_BAND) return 'flat';
  return move > 0 ? 'up' : 'down';
}

/**
 * The latest and previous completed-bar RSI from the `bars` array of /api/chart, or null when they cannot be
 * computed (bad input, too few bars). Never a made-up value.
 */
export function stockRsiFromBars(bars: unknown, now: Date = new Date()): StockRsi | null {
  const closes = completedDailyCloses(bars, now);
  const series = closes ? rsiSeries(closes) : null;
  if (!series || series.length < 2) return null;
  const rsi = series[series.length - 1];
  const previous = series[series.length - 2];
  return { rsi, previous, direction: stockRsiDirection(rsi, previous) };
}
