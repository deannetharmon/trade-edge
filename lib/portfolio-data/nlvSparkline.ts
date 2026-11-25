// lib/portfolio-data/nlvSparkline.ts

// SPARKLINES-0001A (Dean, 2026-11-24): the Portfolio Value tile shows how net liquidating value moved over the last 30 days
// and whether it is up or down from the prior close. Pure helpers, no I/O.
//  * history = completed days only (see balancePerformance.closedDaysOnly); today's figure is the tile's own live value,
//    so the arrow always agrees with the number beside it;
//  * prior close = the last completed day before today; on a weekend there is no live session, so the arrow compares the
//    last two completed days (Friday against Thursday) instead of showing a flat $0;
//  * the line is raw net liquidating value (deposits and withdrawals are not taken out; SPARKLINES-0002).

import { withLivePoint, type BalanceDayPoint } from './balancePerformance';

export const SPARK_DAYS = 30;
/** The prior close must be recent. A longer stretch (weekend plus a holiday is 4 days) means history has a gap, and a day-change against a weeks-old close would be a fake number. */
export const MAX_CLOSE_AGE_DAYS = 5;

export interface NlvSpark {
  /** Ascending, within the window. The last point is the latest figure. */
  points: BalanceDayPoint[];
  priorClose: number | null;
  latest: number | null;
  change: number | null;
  changePct: number | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const usable = (d: BalanceDayPoint) => DATE.test(d.date) && Number.isFinite(d.netLiquidatingValue) && d.netLiquidatingValue > 0;
const utcNoon = (iso: string) => new Date(`${iso}T12:00:00Z`);

export function isWeekend(iso: string): boolean {
  const day = utcNoon(iso).getUTCDay();
  return day === 0 || day === 6;
}

export function addDays(iso: string, n: number): string {
  const d = utcNoon(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((utcNoon(toIso).getTime() - utcNoon(fromIso).getTime()) / 86400000);
}

export function buildNlvSpark(history: readonly BalanceDayPoint[], todayNy: string, liveNlv: number | null, windowDays = SPARK_DAYS): NlvSpark {
  const byDate = new Map<string, BalanceDayPoint>();
  history.filter(usable).filter(d => d.date < todayNy).forEach(d => byDate.set(d.date, { date: d.date, netLiquidatingValue: d.netLiquidatingValue }));
  const closed = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  const live = liveNlv != null && Number.isFinite(liveNlv) && liveNlv > 0 ? liveNlv : null;
  const series = live != null && !isWeekend(todayNy) ? withLivePoint(closed, todayNy, live) : closed;
  const from = addDays(todayNy, -(windowDays - 1));
  const points = series.filter(d => d.date >= from);
  if (series.length < 2) return { points, priorClose: null, latest: series[0]?.netLiquidatingValue ?? null, change: null, changePct: null };
  const latest = series[series.length - 1].netLiquidatingValue;
  const priorClose = series[series.length - 2].netLiquidatingValue;
  const latestDate = series[series.length - 1].date;
  const priorDate = series[series.length - 2].date;
  if (daysBetween(priorDate, latestDate) > MAX_CLOSE_AGE_DAYS || daysBetween(latestDate, todayNy) > MAX_CLOSE_AGE_DAYS) {
    return { points, priorClose: null, latest, change: null, changePct: null };
  }
  const change = latest - priorClose;
  return { points, priorClose, latest, change, changePct: priorClose > 0 ? (change / priorClose) * 100 : null };
}

/** $28k, $25.7k, $1.2M, $950. Axis labels only. */
export function fmtCompact(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (a >= 1000) return `${sign}$${(a / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${sign}$${Math.round(a)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtShortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[(m || 1) - 1]} ${d}`;
}
