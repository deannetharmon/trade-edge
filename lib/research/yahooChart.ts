// lib/research/yahooChart.ts

// RESEARCH-0001: pure helpers for the Research page's price chart. Yahoo's chart JSON in, flat points and headline stats out.

export type ResearchRange = '1D' | '1W' | '1M' | '3M' | '6M' | '1Y' | '5Y';

export const RESEARCH_RANGES: Record<ResearchRange, { range: string; interval: string; ttlSeconds: number }> = {
  '1D': { range: '1d', interval: '5m', ttlSeconds: 60 },
  '1W': { range: '5d', interval: '30m', ttlSeconds: 120 },
  '1M': { range: '1mo', interval: '1d', ttlSeconds: 300 },
  '3M': { range: '3mo', interval: '1d', ttlSeconds: 300 },
  '6M': { range: '6mo', interval: '1d', ttlSeconds: 300 },
  '1Y': { range: '1y', interval: '1d', ttlSeconds: 300 },
  '5Y': { range: '5y', interval: '1wk', ttlSeconds: 600 },
};

export const RESEARCH_RANGE_ORDER: ResearchRange[] = ['1D', '1W', '1M', '3M', '6M', '1Y', '5Y'];

export function isResearchRange(value: unknown): value is ResearchRange {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(RESEARCH_RANGES, value);
}

/** Upper-cased ticker, or null when it is not a plausible symbol (letters, digits, . - ^ =). */
export function normalizeResearchSymbol(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const s = input.trim().toUpperCase();
  return /^[A-Z0-9.^=-]{1,12}$/.test(s) ? s : null;
}

export interface ResearchPoint { t: number; c: number }
export interface ResearchMeta {
  symbol: string;
  name: string | null;
  price: number | null;
  previousClose: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  volume: number | null;
  currency: string | null;
}
export interface ResearchChart { points: ResearchPoint[]; meta: ResearchMeta }

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Parse Yahoo's v8 chart payload. Returns null when it carries no usable result. */
export function parseResearchChart(data: unknown, symbol: string): ResearchChart | null {
  const result = (data as any)?.chart?.result?.[0];
  if (!result) return null;
  const timestamps: unknown[] = Array.isArray(result.timestamp) ? result.timestamp : [];
  const closes: unknown[] = Array.isArray(result.indicators?.quote?.[0]?.close) ? result.indicators.quote[0].close : [];
  const points: ResearchPoint[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const t = num(timestamps[i]);
    const c = num(closes[i]);
    if (t != null && c != null) points.push({ t, c });
  }
  const m = result.meta ?? {};
  return {
    points,
    meta: {
      symbol,
      name: typeof m.longName === 'string' ? m.longName : typeof m.shortName === 'string' ? m.shortName : null,
      price: num(m.regularMarketPrice),
      previousClose: num(m.previousClose) ?? num(m.chartPreviousClose),
      fiftyTwoWeekHigh: num(m.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: num(m.fiftyTwoWeekLow),
      volume: num(m.regularMarketVolume),
      currency: typeof m.currency === 'string' ? m.currency : null,
    },
  };
}

/** Change from the first to the last point (the range's own move), in dollars and percent. */
export function rangeChange(points: readonly ResearchPoint[]): { amount: number; pct: number } | null {
  if (points.length < 2) return null;
  const first = points[0].c;
  const last = points[points.length - 1].c;
  if (!(first > 0)) return null;
  return { amount: last - first, pct: ((last - first) / first) * 100 };
}

/** Today's move against the previous close. */
export function dayChange(price: number | null, previousClose: number | null): { amount: number; pct: number } | null {
  if (price == null || previousClose == null || !(previousClose > 0)) return null;
  return { amount: price - previousClose, pct: ((price - previousClose) / previousClose) * 100 };
}

/** SVG polyline points for a width x height box, plus x position for each point (for hover). */
export function chartGeometry(points: readonly ResearchPoint[], width: number, height: number, pad = 4): { path: string; xs: number[]; ys: number[] } | null {
  if (points.length < 2) return null;
  const min = Math.min(...points.map(p => p.c));
  const max = Math.max(...points.map(p => p.c));
  const span = max - min || 1;
  const xs = points.map((_, i) => (i / (points.length - 1)) * width);
  const ys = points.map(p => pad + (1 - (p.c - min) / span) * (height - pad * 2));
  return { path: xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' '), xs, ys };
}

export interface ChartLevel { price: number; kind: 'support' | 'resistance' | 'extreme'; label: string }
export interface ChartLevelLine extends ChartLevel { y: number }

/**
 * Horizontal level lines for the chart: each level's y on the SAME price scale chartGeometry uses for these points. A level outside
 * the visible price range is dropped, and a level within `minGap` of one already kept is dropped (earlier levels win, so pass the
 * support/resistance levels before the plain highs and lows).
 */
export function chartLevelLines(points: readonly ResearchPoint[], levels: readonly ChartLevel[], height: number, pad = 4, minGap = 9): ChartLevelLine[] {
  if (points.length < 2) return [];
  const min = Math.min(...points.map(p => p.c));
  const max = Math.max(...points.map(p => p.c));
  const span = max - min || 1;
  const kept: ChartLevelLine[] = [];
  for (const l of levels) {
    if (!Number.isFinite(l.price) || l.price < min || l.price > max) continue;
    const yy = pad + (1 - (l.price - min) / span) * (height - pad * 2);
    if (kept.some(k => Math.abs(k.y - yy) < minGap)) continue;
    kept.push({ ...l, y: yy });
  }
  return kept;
}

export interface ChartGapBox { x: number; y1: number; y2: number; side: 'above' | 'below' | 'at'; bottom: number; top: number }

/**
 * Boxes for open gaps on a daily or weekly chart: from the first chart point at or after the gap's time to the right edge, spanning the
 * zone on the same price scale chartGeometry uses. A zone is clipped to the visible price range and dropped when fully outside it.
 */
export function chartGapBoxes(points: readonly ResearchPoint[], gaps: readonly { bottom: number; top: number; t: number; side: 'above' | 'below' | 'at' }[], width: number, height: number, pad = 4): ChartGapBox[] {
  if (points.length < 2) return [];
  const min = Math.min(...points.map(p => p.c));
  const max = Math.max(...points.map(p => p.c));
  const span = max - min || 1;
  const yOf = (p: number) => pad + (1 - (p - min) / span) * (height - pad * 2);
  const out: ChartGapBox[] = [];
  for (const g of gaps) {
    const idx = points.findIndex(p => p.t >= g.t);
    if (idx < 0) continue;
    const lo = Math.max(g.bottom, min);
    const hi = Math.min(g.top, max);
    if (lo >= hi) continue;
    out.push({ x: (idx / (points.length - 1)) * width, y1: yOf(hi), y2: yOf(lo), side: g.side, bottom: g.bottom, top: g.top });
  }
  return out;
}

export interface ResearchBar { t: number; o: number; h: number; l: number; c: number; v?: number }

/** Daily OHLCV bars from Yahoo's chart payload. A bar with any missing OHLC value is dropped (Yahoo pads holidays with nulls); volume is optional. */
export function parseResearchBars(data: unknown): ResearchBar[] | null {
  const result = (data as any)?.chart?.result?.[0];
  if (!result) return null;
  const ts: unknown[] = Array.isArray(result.timestamp) ? result.timestamp : [];
  const q = result.indicators?.quote?.[0] ?? {};
  const bars: ResearchBar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const t = num(ts[i]), o = num(q.open?.[i]), h = num(q.high?.[i]), l = num(q.low?.[i]), c = num(q.close?.[i]);
    if (t == null || o == null || h == null || l == null || c == null) continue;
    const v = num(q.volume?.[i]);
    bars.push(v == null ? { t, o, h, l, c } : { t, o, h, l, c, v });
  }
  return bars;
}
