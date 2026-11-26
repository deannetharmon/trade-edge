// lib/portfolio-data/accountPnl.ts

// SPARKLINES-0001E (Dean, 2026-11-26): the Total tile line only summed the positions open today, so every earlier day the
// account was ahead (closed trades, premium kept) was missing. This line is the account's own profit: net liquidating value
// minus all money put in (plus money taken out) up to that day, so deposits and withdrawals never read as trading results
// and closed trades are included. Pure helpers, no I/O. Source: stored end-of-day balances + broker money movements.
//  * closed days only; today is the live Portfolio Value less the money moved to date;
//  * nothing is drawn unless money movements were read (without them the figure would be wrong, not just rough);
//  * the whole stored history is drawn (not 30 days) so the earlier stretch is visible.

import { daysBetween, isWeekend, MAX_CLOSE_AGE_DAYS, type NlvSpark } from './nlvSparkline';
import type { BalanceDayPoint, MoneyMovement } from './balancePerformance';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function buildAccountPnlSpark(history: readonly BalanceDayPoint[], movements: readonly MoneyMovement[] | null, todayNy: string, liveNlv: number | null): NlvSpark | null {
  if (movements == null) return null;
  const movedThrough = (date: string) => movements.filter(m => m.date <= date).reduce((sum, m) => sum + m.amount, 0);
  const byDate = new Map<string, number>();
  history
    .filter(d => DATE.test(d.date) && d.date < todayNy && Number.isFinite(d.netLiquidatingValue) && d.netLiquidatingValue > 0)
    .forEach(d => byDate.set(d.date, d.netLiquidatingValue - movedThrough(d.date)));
  const series = Array.from(byDate.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([date, value]) => ({ date, netLiquidatingValue: value }));
  if (liveNlv != null && Number.isFinite(liveNlv) && liveNlv > 0 && !isWeekend(todayNy)) series.push({ date: todayNy, netLiquidatingValue: liveNlv - movedThrough(todayNy) });
  if (series.length < 2) return { points: series, priorClose: null, latest: series[0]?.netLiquidatingValue ?? null, change: null, changePct: null };
  const last = series[series.length - 1];
  const prior = series[series.length - 2];
  if (daysBetween(prior.date, last.date) > MAX_CLOSE_AGE_DAYS || daysBetween(last.date, todayNy) > MAX_CLOSE_AGE_DAYS) {
    return { points: series, priorClose: null, latest: last.netLiquidatingValue, change: null, changePct: null };
  }
  return { points: series, priorClose: prior.netLiquidatingValue, latest: last.netLiquidatingValue, change: last.netLiquidatingValue - prior.netLiquidatingValue, changePct: null };
}

/** First stored day, for the caption ("since Jul 2"). */
export function accountPnlSince(spark: NlvSpark | null): string | null {
  return spark?.points[0]?.date ?? null;
}

