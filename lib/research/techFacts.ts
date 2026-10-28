// lib/research/techFacts.ts

// RESEARCH-0002 (Alan's spec): price-structure FACTS from daily OHLCV bars. Facts only: no scores, no thresholds, no verdicts.
// Pure and fail-closed: malformed, unordered or non-positive bars make every fact null; nothing is repaired or skipped.
// Bars must be COMPLETED daily bars (the caller drops the still-forming bar), oldest first, `t` in Unix seconds.

export interface FactBar { t: number; o: number; h: number; l: number; c: number; v?: number }

export const ATR_PERIOD = 14;
export const PIVOT_SIDE_BARS = 3;
export const LEVEL_CLUSTER_ATR = 0.5;
export const MIN_LEVEL_BARS = 60;
export const VOLUME_SHORT = 20;
export const VOLUME_LONG = 60;
export const REL_STRENGTH_LOOKBACK = 126;

function validBars(bars: unknown): bars is FactBar[] {
  if (!Array.isArray(bars) || bars.length === 0) return false;
  let prevT = -Infinity;
  for (const b of bars as FactBar[]) {
    if (!b || ![b.t, b.o, b.h, b.l, b.c].every(x => typeof x === 'number' && Number.isFinite(x)) || b.o <= 0 || b.h <= 0 || b.l <= 0 || b.c <= 0 || b.h < b.l || b.t <= prevT) return false;
    prevT = b.t;
  }
  return true;
}

/** Wilder ATR(14): the first value is the mean of the first 14 true ranges, then (prev * 13 + TR) / 14. Null under 15 bars. */
export function atr14(bars: unknown): number | null {
  if (!validBars(bars) || bars.length < ATR_PERIOD + 1) return null;
  const tr = (i: number) => Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c));
  let atr = 0;
  for (let i = 1; i <= ATR_PERIOD; i += 1) atr += tr(i);
  atr /= ATR_PERIOD;
  for (let i = ATR_PERIOD + 1; i < bars.length; i += 1) atr = (atr * (ATR_PERIOD - 1) + tr(i)) / ATR_PERIOD;
  return atr;
}

export interface KeyLevel { price: number; touches: number; lastTouchT: number }
export interface KeyLevels { supports: KeyLevel[]; resistances: KeyLevel[] }

/**
 * Swing pivots (a high above the 3 bars before it and at least the 3 after; the mirror for lows), merged into one level when
 * within half an ATR of each other. The last 3 bars cannot confirm a pivot. Supports sit below the last close, resistances above;
 * each side lists the nearest three. Null when there are fewer than 60 bars.
 */
export function keyLevels(bars: unknown): KeyLevels | null {
  if (!validBars(bars) || bars.length < MIN_LEVEL_BARS) return null;
  const last = bars[bars.length - 1].c;
  const atr = atr14(bars);
  const tolerance = (atr ?? last * 0.01) * LEVEL_CLUSTER_ATR;
  const k = PIVOT_SIDE_BARS;
  const pivots: { price: number; t: number }[] = [];
  for (let i = k; i < bars.length - k; i += 1) {
    const left = bars.slice(i - k, i);
    const right = bars.slice(i + 1, i + 1 + k);
    if (bars[i].h > Math.max(...left.map(b => b.h)) && bars[i].h >= Math.max(...right.map(b => b.h))) pivots.push({ price: bars[i].h, t: bars[i].t });
    if (bars[i].l < Math.min(...left.map(b => b.l)) && bars[i].l <= Math.min(...right.map(b => b.l))) pivots.push({ price: bars[i].l, t: bars[i].t });
  }
  pivots.sort((a, b) => a.price - b.price);
  const levels: KeyLevel[] = [];
  let group: { price: number; t: number }[] = [];
  const flush = () => {
    if (!group.length) return;
    levels.push({ price: group.reduce((s, p) => s + p.price, 0) / group.length, touches: group.length, lastTouchT: Math.max(...group.map(p => p.t)) });
    group = [];
  };
  for (const p of pivots) {
    if (group.length && p.price - group[group.length - 1].price > tolerance) flush();
    group.push(p);
  }
  flush();
  return {
    supports: levels.filter(l => l.price < last).sort((a, b) => b.price - a.price).slice(0, 3),
    resistances: levels.filter(l => l.price > last).sort((a, b) => a.price - b.price).slice(0, 3),
  };
}

export const GAP_MIN_ATR = 0.5;
export const GAPS_PER_SIDE = 3;
/** The part of a price gap that has not traded back. `side` is where it sits against the last close. `t` is the gap bar's time. */
export interface OpenGap { bottom: number; top: number; t: number; side: 'above' | 'below' | 'at' }

/**
 * Open (unfilled) daily gaps. A gap up is a bar whose low is above the prior bar's high; a gap down is the mirror. A later bar that
 * trades back into the zone shrinks it, and one that trades through it fills it (dropped). Gaps whose open part is under half an ATR
 * are dropped, and each side of the last close keeps the nearest three. Facts only: nothing here says a gap will fill.
 */
export function openGaps(bars: unknown): OpenGap[] {
  if (!validBars(bars) || bars.length < 2) return [];
  const last = bars[bars.length - 1].c;
  const atr = atr14(bars) ?? last * 0.01;
  const minSize = atr * GAP_MIN_ATR;
  const out: OpenGap[] = [];
  for (let i = 1; i < bars.length; i += 1) {
    const prev = bars[i - 1];
    const cur = bars[i];
    let bottom: number, top: number;
    if (cur.l > prev.h) {
      bottom = prev.h; top = cur.l;
      const lowAfter = Math.min(...bars.slice(i + 1).map(b => b.l), Infinity);
      if (lowAfter <= bottom) continue;
      top = Math.min(top, lowAfter);
    } else if (cur.h < prev.l) {
      bottom = cur.h; top = prev.l;
      const highAfter = Math.max(...bars.slice(i + 1).map(b => b.h), -Infinity);
      if (highAfter >= top) continue;
      bottom = Math.max(bottom, highAfter);
    } else continue;
    if (top - bottom < minSize) continue;
    out.push({ bottom, top, t: cur.t, side: bottom > last ? 'above' : top < last ? 'below' : 'at' });
  }
  const dist = (g: OpenGap) => (g.side === 'above' ? g.bottom - last : g.side === 'below' ? last - g.top : 0);
  const pick = (side: OpenGap['side']) => out.filter(g => g.side === side).sort((a, b) => dist(a) - dist(b)).slice(0, GAPS_PER_SIDE);
  return [...pick('above'), ...pick('at'), ...pick('below')];
}

export const RECENT_RANGE_BARS = 20;
export const YEAR_RANGE_BARS = 250;
export interface RangeExtremes { high20: number | null; low20: number | null; high52w: number | null; low52w: number | null }

/**
 * Highest high and lowest low of the last 20 and the last 250 completed sessions. Unlike key levels these need no confirmation, so the
 * ceiling or floor price is pressing right now is never missing. A window without enough bars gives null.
 */
export function rangeExtremes(bars: unknown): RangeExtremes {
  const none: RangeExtremes = { high20: null, low20: null, high52w: null, low52w: null };
  if (!validBars(bars)) return none;
  const span = (n: number) => (bars.length >= n ? bars.slice(-n) : null);
  const w20 = span(RECENT_RANGE_BARS);
  const w52 = span(YEAR_RANGE_BARS);
  return {
    high20: w20 ? Math.max(...w20.map(b => b.h)) : null,
    low20: w20 ? Math.min(...w20.map(b => b.l)) : null,
    high52w: w52 ? Math.max(...w52.map(b => b.h)) : null,
    low52w: w52 ? Math.min(...w52.map(b => b.l)) : null,
  };
}

/** Average daily volume of the last 20 completed bars divided by the last 60. Null when any of those 60 bars has no volume. */
export function volumeRatio(bars: unknown): number | null {
  if (!validBars(bars) || bars.length < VOLUME_LONG) return null;
  const vols = bars.slice(-VOLUME_LONG).map(b => b.v);
  if (!vols.every((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0)) return null;
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const long = avg(vols);
  return long > 0 ? avg(vols.slice(-VOLUME_SHORT)) / long : null;
}

/** Stock return minus benchmark return over the same 126 completed sessions, in percentage points. Null unless both series cover the window and end on the same day. */
export function relativeStrength(stock: unknown, benchmark: unknown): { stockPct: number; benchmarkPct: number; diffPts: number } | null {
  if (!validBars(stock) || !validBars(benchmark)) return null;
  if (stock.length <= REL_STRENGTH_LOOKBACK || benchmark.length <= REL_STRENGTH_LOOKBACK) return null;
  const s1 = stock[stock.length - 1], b1 = benchmark[benchmark.length - 1];
  if (s1.t !== b1.t) return null;
  const s0 = stock[stock.length - 1 - REL_STRENGTH_LOOKBACK], b0 = benchmark[benchmark.length - 1 - REL_STRENGTH_LOOKBACK];
  const stockPct = ((s1.c - s0.c) / s0.c) * 100;
  const benchmarkPct = ((b1.c - b0.c) / b0.c) * 100;
  return { stockPct, benchmarkPct, diffPts: stockPct - benchmarkPct };
}

export const RETURN_WINDOWS = { m1: 21, m3: 63, m6: 126 } as const;
export interface HorizonReturns { m1: number | null; m3: number | null; m6: number | null }

/** Percent change of the last completed close against the close N completed sessions earlier, for 1, 3 and 6 months (21, 63, 126 sessions). */
export function horizonReturns(bars: unknown): HorizonReturns {
  const out: HorizonReturns = { m1: null, m3: null, m6: null };
  if (!validBars(bars)) return out;
  const last = bars[bars.length - 1].c;
  (Object.keys(RETURN_WINDOWS) as (keyof HorizonReturns)[]).forEach(k => {
    const n = RETURN_WINDOWS[k];
    if (bars.length > n) out[k] = ((last - bars[bars.length - 1 - n].c) / bars[bars.length - 1 - n].c) * 100;
  });
  return out;
}

export interface StrikeContext {
  pctBelowPrice: number;
  atrsBelowPrice: number | null;
  nearestSupportBelowStrike: { price: number; pctBelowStrike: number } | null;
}

/** Where a put strike sits: how far below the price (percent and ATRs) and how far above the nearest support at or below it. */
export function strikeContext(strike: number, price: number, atr: number | null, levels: KeyLevels | null): StrikeContext | null {
  if (![strike, price].every(x => Number.isFinite(x) && x > 0)) return null;
  const support = levels?.supports.filter(l => l.price <= strike).sort((a, b) => b.price - a.price)[0] ?? null;
  return {
    pctBelowPrice: ((price - strike) / price) * 100,
    atrsBelowPrice: atr != null && atr > 0 ? (price - strike) / atr : null,
    nearestSupportBelowStrike: support ? { price: support.price, pctBelowStrike: ((strike - support.price) / strike) * 100 } : null,
  };
}
