// features/portfolio/positions-workspace/model/stockEarnings.ts
//
// Next earnings dates for held shares, read from the broker's market-metrics response (the same source the option rows use).
// Display only. A symbol with no date in the response (ETFs, or a date beyond the provider's window) simply has no entry.

export interface StockEarnings {
  date: string;
  /** True when the provider marks the date as a projection; null when it does not say. */
  estimated: boolean | null;
}

/** Pure: pulls { symbol: { date, estimated } } out of a market-metrics payload, ignoring anything malformed. */
export function parseMarketMetricsEarnings(payload: unknown): Record<string, StockEarnings> {
  const out: Record<string, StockEarnings> = {};
  const items = (payload as { data?: { items?: unknown } } | null)?.data?.items;
  if (!Array.isArray(items)) return out;
  for (const item of items) {
    const symbol = (item as { symbol?: unknown })?.symbol;
    const earnings = (item as { earnings?: unknown })?.earnings as Record<string, unknown> | string | null | undefined;
    if (typeof symbol !== 'string' || !earnings) continue;
    const raw = typeof earnings === 'string' ? earnings : earnings['expected-report-date'];
    if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(raw)) continue;
    const flag = typeof earnings === 'string' ? undefined : earnings['estimated'];
    out[symbol.toUpperCase()] = { date: raw.slice(0, 10), estimated: typeof flag === 'boolean' ? flag : null };
  }
  return out;
}

/** The broker proxy path for a set of symbols (browser-side only; the proxy is same-origin). */
export function marketMetricsPath(symbols: readonly string[]): string {
  return `/api/tastytrade/proxy?path=${encodeURIComponent(`/market-metrics?symbols=${symbols.join(',')}`)}`;
}
