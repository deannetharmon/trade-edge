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
  /** Dated RSI per completed bar (oldest first, New York dates). Optional so callers that only need the number can ignore it. */
  points?: StockRsiPoint[];
}

export interface StockRsiPoint {
  /** YYYY-MM-DD on the New York calendar. */
  date: string;
  rsi: number;
}

const nyDateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });

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
  // series[j] belongs to closes[j + 14] = bars[j + 14]; only the last bar can be dropped, so the first bars line up 1:1.
  const points: StockRsiPoint[] = [];
  const list = bars as Array<{ t: number }>;
  const offset = closes!.length - series.length;
  for (let j = 0; j < series.length; j += 1) {
    const bar = list[j + offset];
    if (!bar) { points.length = 0; break; }
    points.push({ date: nyDateFormatter.format(new Date(bar.t * 1000)), rsi: series[j] });
  }
  return { rsi, previous, direction: stockRsiDirection(rsi, previous), points: points.length === series.length ? points : undefined };
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * Which completed bar the RSI belongs to, from the last point's New York date (YYYY-MM-DD): `{ short: 'Fri close', long: 'Fri 11/6' }`.
 * Null when the date is unknown. Display only: the RSI itself always comes from completed bars, so today's session is never in it.
 */
export function rsiAsOfLabel(points: StockRsiPoint[] | undefined): { short: string; long: string } | null {
  const date = points && points.length > 0 ? points[points.length - 1].date : null;
  const m = date ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null;
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay()];
  return { short: `${weekday} close`, long: `${weekday} ${month}/${day}` };
}

/**
 * RSI on the last completed bar on or before `entryDate` (YYYY-MM-DD). Null when the date is outside the loaded window
 * (older than the first RSI value, or after the latest completed bar), so an unknowable entry is never estimated.
 */
export function rsiAtEntry(points: StockRsiPoint[] | undefined, entryDate: string | null | undefined): StockRsiPoint | null {
  if (!points || points.length === 0 || !entryDate || !/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) return null;
  if (entryDate < points[0].date || entryDate > points[points.length - 1].date) return null;
  let found: StockRsiPoint | null = null;
  for (const point of points) { if (point.date <= entryDate) found = point; else break; }
  return found;
}
