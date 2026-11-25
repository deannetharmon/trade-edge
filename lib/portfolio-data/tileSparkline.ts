// lib/portfolio-data/tileSparkline.ts

// SPARKLINES-0001B/C (Dean, 2026-11-24): history lines for the Total, LEAP and Equity P/L tiles and for Deployed Capital.
// Pure helpers, no I/O. Source: the daily records in /api/position-snapshots.
//  * a tile's line is the sum of its CURRENTLY OPEN positions' daily P/L ("same positions only"; closed positions are not replayed);
//  * a position that opened mid-window adds nothing before its first record; a day where an already-open position has no record is skipped, never guessed;
//  * the record is the first reading of the day (the page's first load), so it is "as of the day's first look", not a strict close;
//  * if any position in the tile has no earlier record yet, the whole line waits (no partial line that ends in a cliff);
//  * weekends are dropped; the prior value must be recent (MAX_CLOSE_AGE_DAYS) or there is no day-change and no colour.

import { addDays, daysBetween, isWeekend, MAX_CLOSE_AGE_DAYS, SPARK_DAYS, type NlvSpark } from './nlvSparkline';

export interface SnapRec { date: string; pnl?: number | null; currentValue?: number | null }
export type SnapStore = Record<string, SnapRec[]>;
export interface SeriesPoint { date: string; value: number }
export interface SeriesSpark { points: SeriesPoint[]; priorValue: number | null; latest: number | null; change: number | null }

/** Record key for the daily Deployed Capital figure (its value is stored in currentValue). */
export const DEPLOYED_KEY = 'PORTFOLIO:DEPLOYED';
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function dailyValues(recs: readonly SnapRec[] | undefined, pick: (r: SnapRec) => number | null | undefined, todayNy: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of recs ?? []) {
    const v = pick(r);
    if (!DATE.test(r.date) || r.date >= todayNy || isWeekend(r.date) || v == null || !Number.isFinite(v)) continue;
    if (!out.has(r.date)) out.set(r.date, v); // first reading of the day wins
  }
  return out;
}

function finish(closed: SeriesPoint[], todayNy: string, live: number | null): SeriesSpark {
  const series = live != null && Number.isFinite(live) && !isWeekend(todayNy) ? [...closed, { date: todayNy, value: live }] : closed;
  const from = addDays(todayNy, -(SPARK_DAYS - 1));
  const points = series.filter(p => p.date >= from);
  if (series.length < 2) return { points, priorValue: null, latest: series[0]?.value ?? null, change: null };
  const last = series[series.length - 1];
  const prior = series[series.length - 2];
  if (daysBetween(prior.date, last.date) > MAX_CLOSE_AGE_DAYS || daysBetween(last.date, todayNy) > MAX_CLOSE_AGE_DAYS) {
    return { points, priorValue: null, latest: last.value, change: null };
  }
  return { points, priorValue: prior.value, latest: last.value, change: last.value - prior.value };
}

/** members = the tile's open positions; livePnl = the tile's own P/L now (null when some position is unpriced). */
export function buildTileSpark(store: SnapStore, members: ReadonlyArray<{ key: string; pnl: number | null }>, todayNy: string, livePnl: number | null): SeriesSpark {
  const per = members.map(m => dailyValues(store[m.key], r => r.pnl, todayNy));
  const first = per.map(m => (m.size ? Array.from(m.keys()).sort()[0] : null));
  // A position with no earlier record (a stock holding before its first record, or a position opened today) has an unknown past.
  // Drawing the others and then jumping to a live total that includes it would be a false cliff, so the line waits (dashed) until
  // every position in the tile has at least one earlier record.
  if (members.length === 0 || first.some(f => f == null)) return finish([], todayNy, null);
  const dates = new Set<string>();
  per.forEach(m => m.forEach((_v, d) => dates.add(d)));
  const closed: SeriesPoint[] = [];
  Array.from(dates).sort().forEach(d => {
    let sum = 0;
    let ok = true;
    per.forEach((m, i) => {
      const f = first[i];
      if (f == null || d < f) return; // not open yet
      const v = m.get(d);
      if (v == null) ok = false; else sum += v;
    });
    if (ok) closed.push({ date: d, value: sum });
  });
  return finish(closed, todayNy, livePnl);
}

export function buildDeployedSpark(store: SnapStore, todayNy: string, liveDeployed: number | null): SeriesSpark {
  const m = dailyValues(store[DEPLOYED_KEY], r => r.currentValue, todayNy);
  const closed = Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([date, value]) => ({ date, value }));
  return finish(closed, todayNy, liveDeployed);
}

/** Adapter so the shared axis chart (NlvSparkline) can draw a series. */
export function toNlvSpark(s: SeriesSpark): NlvSpark {
  return {
    points: s.points.map(p => ({ date: p.date, netLiquidatingValue: p.value })),
    priorClose: s.priorValue, latest: s.latest, change: s.change,
    changePct: s.priorValue != null && s.priorValue !== 0 && s.change != null ? (s.change / Math.abs(s.priorValue)) * 100 : null,
  };
}
