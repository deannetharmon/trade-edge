// lib/trademap/headerRsi.ts
//
// OPTMAP-0001 S6: daily and weekly RSI(14) for the Trade Map header ("RSI 52 D · 58 W"). Display only: no verdict,
// colour or gate. Nothing new is calculated here:
//   daily   = the screener card / held-stock RSI pipeline (stockRsiFromBars: completed daily bars -> Wilder RSI),
//             so the same ticker shows the same number on every screen;
//   weekly  = the LEAPS technicals resampler (periodCloses + wilderRsiSeries) on two years of daily closes; a
//             half-finished week never feeds it.
// Each value is null (shown as a dash) when its data is missing or too short. Never throws.

import { stockRsiFromBars } from '@/lib/portfolio/stockRsi';
import { barsProblem, periodCloses, wilderRsiSeries, type DailyBar } from '@/lib/discovery/normalized/technicals';
import { epochDay } from '@/lib/discovery/normalized/dates';
import { YAHOO_INDEX_CHART_MAP } from '@/lib/scans/constants';
import { fetchDailyBars } from '@/lib/scans/dailyBarsMemo';
import { normalizeTickerToken } from '@/lib/scans/scan-utils';

export interface HeaderRsi {
  daily: number | null;
  weekly: number | null;
}

/** RSI values from already-fetched bars. `dailyBars` is /api/chart's `bars`; `longBars` is /api/chart-history's `closes`. */
export function headerRsiFromBars(dailyBars: unknown, longBars: unknown, now: Date = new Date()): HeaderRsi {
  let daily: number | null = null;
  try { daily = stockRsiFromBars(dailyBars, now)?.rsi ?? null; } catch { daily = null; }
  let weekly: number | null = null;
  try {
    if (Array.isArray(longBars) && barsProblem(longBars) == null) {
      const closes = periodCloses(longBars as DailyBar[], 'WEEK', epochDay(Math.floor(now.getTime() / 1000)));
      const series = wilderRsiSeries(closes);
      weekly = series && series.length > 0 ? series[series.length - 1] : null;
    }
  } catch { weekly = null; }
  return { daily, weekly };
}

/** "52", or a dash when there is no value. */
export function formatRsi(v: number | null): string {
  return v == null || !Number.isFinite(v) ? '—' : String(Math.round(v));
}

/** Fetches both series for one symbol; a failed fetch leaves that value null. */
export async function fetchHeaderRsi(symbol: string, now: Date = new Date()): Promise<HeaderRsi> {
  const clean = normalizeTickerToken(symbol) ?? symbol.toUpperCase();
  if (!clean.trim()) return { daily: null, weekly: null };
  const chartSymbol = YAHOO_INDEX_CHART_MAP[clean] ?? clean;
  const [daily, long] = await Promise.all([
    fetchDailyBars(chartSymbol, clean).catch(() => null),
    fetch(`/api/chart-history?symbol=${encodeURIComponent(chartSymbol)}&years=2`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => j?.closes ?? null)
      .catch(() => null),
  ]);
  return headerRsiFromBars(daily, long, now);
}
