// lib/research/researchRsi.ts

// RESEARCH-RSI-0001: RSI(14) panel under the Research price chart. INFORMATION ONLY: never an input to scoring or qualification.
// RSI needs 14 bars of warm-up, so a short chart (1M is about 21 daily bars) is lined up against a longer source series
// and only the values that fall inside the visible window are drawn. Pure helpers; no fetching here.

import { RSI_PERIOD, rsiSeries } from '@/lib/indicators/rsi';
import { RSI_TURN_PARAMS } from '@/lib/indicators/rsiTurn';
import type { ResearchPoint, ResearchRange } from '@/lib/research/yahooChart';

export const RSI_LOW = RSI_TURN_PARAMS.low;
export const RSI_HIGH = RSI_TURN_PARAMS.high;

/** Ranges that show RSI. 1D and 1W are intraday bars, where RSI(14) is not the daily indicator the rest of the app uses. */
export function rsiAvailableForRange(range: ResearchRange): boolean {
  return range !== '1D' && range !== '1W';
}

/** Daily ranges shorter than the warm-up allows; they borrow a 1Y daily series. 1Y and 5Y use their own points. */
export function rsiNeedsLongerSource(range: ResearchRange): boolean {
  return range === '1M' || range === '3M' || range === '6M';
}

/**
 * One RSI value per visible point (null where there is none yet). `source` is oldest first and must contain the visible
 * points' timestamps; values are matched by timestamp, so the source may start earlier than the visible window.
 */
export function rsiForVisiblePoints(visible: readonly ResearchPoint[], source: readonly ResearchPoint[]): (number | null)[] {
  const series = rsiSeries(source.map(p => p.c));
  if (!series) return visible.map(() => null);
  const byTime = new Map<number, number>();
  series.forEach((value, j) => byTime.set(source[j + RSI_PERIOD].t, value));
  return visible.map(p => byTime.get(p.t) ?? null);
}

export interface RsiLine { points: string; }

/**
 * SVG polyline segments for the RSI values, x matched to the price chart (`i / (n - 1) * width`). A gap (null) starts a new
 * segment. Values are clamped to 0..100 and drawn on a fixed 0-100 scale so 30 and 70 always sit in the same place.
 */
export function rsiSegments(values: readonly (number | null)[], width: number, height: number, pad = 4): RsiLine[] {
  const n = values.length;
  if (n < 2) return [];
  const y = (v: number) => pad + (1 - Math.min(100, Math.max(0, v)) / 100) * (height - pad * 2);
  const segments: string[][] = [];
  let current: string[] | null = null;
  values.forEach((v, i) => {
    if (v == null) { current = null; return; }
    if (!current) { current = []; segments.push(current); }
    current.push(`${((i / (n - 1)) * width).toFixed(1)},${y(v).toFixed(1)}`);
  });
  return segments.filter(s => s.length >= 2).map(s => ({ points: s.join(' ') }));
}

/** Y position of a reference value on the same fixed 0-100 scale (for the 30 and 70 lines). */
export function rsiY(value: number, height: number, pad = 4): number {
  return pad + (1 - Math.min(100, Math.max(0, value)) / 100) * (height - pad * 2);
}
