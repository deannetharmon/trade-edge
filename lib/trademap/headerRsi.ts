// lib/trademap/headerRsi.ts
//
// OPTMAP-0001 S6: daily and weekly RSI(14) for the Trade Map header ("RSI 52 D · 58 W"). Display only: no verdict,
// colour or gate. Nothing new is calculated here:
//   daily   = the screener card / held-stock RSI pipeline (stockRsiFromBars: completed daily bars -> Wilder RSI),
//             so the same ticker shows the same number on every screen;
//   weekly  = Wilder RSI (lib/indicators/rsi.ts, the same function as daily) on completed Monday-based weekly closes
//             from two years of daily closes; a half-finished week never feeds it. This follows the LEAPS technicals
//             resampler's rule (lib/discovery is isolated from the rest of the app, so it is restated here and pinned by tests).
// Each value is null (shown as a dash) when its data is missing or too short. Never throws.

import { stockRsiFromBars } from '@/lib/portfolio/stockRsi';
import { rsiSeries } from '@/lib/indicators/rsi';
import { YAHOO_INDEX_CHART_MAP } from '@/lib/scans/constants';
import { fetchDailyBars } from '@/lib/scans/dailyBarsMemo';
import { normalizeTickerToken } from '@/lib/scans/scan-utils';

export interface HeaderRsi {
  daily: number | null;
  weekly: number | null;
}

const SECONDS_PER_DAY = 86_400;
/** Epoch day of the Monday of the week holding `epochSeconds` (epoch day 0 was a Thursday). */
const mondayKey = (epochSeconds: number): number => {
  const day = Math.floor(epochSeconds / SECONDS_PER_DAY);
  return day - ((day + 3) % 7);
};

/**
 * Closes of COMPLETED weeks from ascending daily bars ({ t: unix seconds, c }). The last week is dropped unless `nowSeconds`
 * falls in a later week than the last bar. Null when any bar is malformed, unsorted or duplicated (nothing is repaired).
 */
export function completedWeeklyCloses(bars: unknown, nowSeconds: number): number[] | null {
  if (!Array.isArray(bars) || bars.length === 0) return null;
  const closes: number[] = [];
  let currentKey: number | null = null;
  let previousT = -Infinity;
  for (const bar of bars as unknown[]) {
    if (typeof bar !== 'object' || bar === null) return null;
    const { t, c } = bar as { t?: unknown; c?: unknown };
    if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0 || t <= previousT) return null;
    if (typeof c !== 'number' || !Number.isFinite(c) || c <= 0) return null;
    previousT = t;
    const key = mondayKey(t);
    if (key !== currentKey) { closes.push(c); currentKey = key; } else { closes[closes.length - 1] = c; }
  }
  if (currentKey != null && mondayKey(nowSeconds) <= currentKey) closes.pop();
  return closes;
}

/** RSI values from already-fetched bars. `dailyBars` is /api/chart's `bars`; `longBars` is /api/chart-history's `closes`. */
export function headerRsiFromBars(dailyBars: unknown, longBars: unknown, now: Date = new Date()): HeaderRsi {
  let daily: number | null = null;
  try { daily = stockRsiFromBars(dailyBars, now)?.rsi ?? null; } catch { daily = null; }
  let weekly: number | null = null;
  try {
    const closes = completedWeeklyCloses(longBars, Math.floor(now.getTime() / 1000));
    const series = closes ? rsiSeries(closes) : null;
    weekly = series && series.length > 0 ? series[series.length - 1] : null;
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
