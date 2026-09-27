// lib/wheel/candidateData.ts
//
// WHEEL-SYSTEM-0002 (W2) -- fetch adapters for the "Next candidate" checks. Kept apart from the component so they can be
// tested with injected fetchers.
//
//  * IVR and the expected earnings date come from the broker's market metrics (`getMarketMetrics` in
//    lib/scans/tastytrade-client.ts, which returns IVR already scaled to a percent). Symbols go in small batches; a failed
//    batch marks only its own symbols unavailable, never the whole table.
//  * RSI comes from the daily closes of GET /api/chart?symbol= (server-side Yahoo, about 125 daily closes; this is not a
//    broker call). Too few closes means RSI is unknown.

import { getMarketMetrics } from '@/lib/scans/tastytrade-client';

export const METRICS_BATCH_SIZE = 20;

export interface MetricsItem {
  ivrPercent: number | null;
  earningsDate: string | null;
}

export interface MetricsResult {
  /** Keyed by upper-cased symbol. A symbol missing here (its batch failed, or the broker returned no record) is unavailable. */
  items: Record<string, MetricsItem>;
  /** Symbols whose batch failed outright. */
  failed: string[];
}

type MetricsFetcher = (symbols: string[], token: string) => Promise<Array<{ symbol?: string; ivRank?: number | null; earningsExpectedDate?: string | null }>>;

export async function fetchMetricsBatch(
  symbols: string[],
  token: string,
  fetcher: MetricsFetcher = getMarketMetrics as unknown as MetricsFetcher,
): Promise<MetricsResult> {
  const unique = Array.from(new Set(symbols.map((s) => s.toUpperCase())));
  const items: Record<string, MetricsItem> = {};
  const failed: string[] = [];
  for (let i = 0; i < unique.length; i += METRICS_BATCH_SIZE) {
    const chunk = unique.slice(i, i + METRICS_BATCH_SIZE);
    try {
      const rows = await fetcher(chunk, token);
      for (const row of rows ?? []) {
        const symbol = typeof row?.symbol === 'string' ? row.symbol.trim().toUpperCase() : '';
        if (!symbol) continue;
        items[symbol] = {
          ivrPercent: typeof row.ivRank === 'number' && Number.isFinite(row.ivRank) ? row.ivRank : null,
          earningsDate: typeof row.earningsExpectedDate === 'string' && row.earningsExpectedDate ? row.earningsExpectedDate : null,
        };
      }
    } catch {
      failed.push(...chunk);
    }
  }
  return { items, failed };
}

/** Daily closes for one symbol from the app's chart route, or null when they cannot be read. */
export async function fetchDailyCloses(symbol: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<number[] | null> {
  try {
    const res = await fetchImpl(`/api/chart?symbol=${encodeURIComponent(symbol)}`);
    if (!res.ok) return null;
    const payload = (await res.json()) as { bars?: Array<{ c?: number | null }>; error?: unknown };
    if (!Array.isArray(payload?.bars)) return null;
    const closes = payload.bars.map((bar) => bar?.c);
    return closes.filter((c): c is number => typeof c === 'number' && Number.isFinite(c));
  } catch {
    return null;
  }
}
