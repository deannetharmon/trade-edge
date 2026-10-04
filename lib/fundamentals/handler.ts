// lib/fundamentals/handler.ts

// LEAPS-QV-0001 Gate 2b -- request handler behind /api/fundamentals. Dependencies are injected so the auth, validation,
// and error mapping are testable without the network. Server-side only (SEC and Yahoo are both reached from here).

import { dropFormingBars } from '@/lib/discovery/normalized/exchangeCalendar';
import { BENCHMARK_SYMBOL, PRICE_BASIS_QUOTE } from '@/lib/discovery/normalized/technicals';
import type { DailyBar } from '@/lib/discovery/normalized/technicals';
import { loadSecFundamentals, normalizeTicker } from './secFundamentals';
import type { LoadedFundamentals } from './secFundamentals';
import type { SecClient } from './sec/client';

export const PRICE_HISTORY_YEARS = 6;

export interface PriceHistory {
  readonly closes: readonly DailyBar[] | null;
  readonly issue: string | null;
  /** Price basis of the series (Gate 2c). Stock and benchmark must carry the same basis. */
  readonly basis?: string;
}

export interface HandlerDeps {
  readonly userId: string | null;
  readonly client: SecClient;
  readonly fetchPriceHistory: (symbol: string) => Promise<PriceHistory>;
  readonly nowIso: () => string;
}

export interface HandlerResponse {
  readonly status: number;
  readonly body: LoadedFundamentals | { readonly error: string };
}

export async function handleFundamentalsRequest(rawSymbol: string | null, deps: HandlerDeps): Promise<HandlerResponse> {
  if (!deps.userId) return { status: 401, body: { error: 'Unauthorized' } };
  if (!rawSymbol) return { status: 400, body: { error: 'symbol param required' } };
  const symbol = normalizeTicker(rawSymbol);
  if (!symbol) return { status: 400, body: { error: 'symbol is not a supported equity ticker' } };

  const safeFetch = async (sym: string, failure: string): Promise<PriceHistory> => {
    try {
      return await deps.fetchPriceHistory(sym);
    } catch (_err) {
      return { closes: null, issue: failure };
    }
  };
  // SPY is fetched once per request (and reused when the requested symbol is SPY). A SPY failure only costs the benchmark-derived
  // metrics (relative_return_126d_*); it never fails the request or the SEC / stock-only metrics.
  const [price, spy] = await Promise.all([
    safeFetch(symbol, 'PRICE_FETCH_FAILED'),
    symbol === BENCHMARK_SYMBOL ? Promise.resolve<PriceHistory | null>(null) : safeFetch(BENCHMARK_SYMBOL, 'PRICE_FETCH_FAILED'),
  ]);
  const benchmarkSource = spy === null ? price : spy;

  // Only COMPLETED sessions reach the metric layer: the still-forming trailing bar is dropped by the exchange calendar.
  const evaluatedAt = deps.nowIso();
  const stock = price.closes ? dropFormingBars(price.closes, evaluatedAt) : null;
  const bench = benchmarkSource.closes ? dropFormingBars(benchmarkSource.closes, evaluatedAt) : null;
  const calendarIssue = (stock && stock.status !== 'OK') || (bench && bench.status !== 'OK') ? 'SESSION_CALENDAR_UNAVAILABLE' : null;
  const loaded = await loadSecFundamentals(symbol, {
    client: deps.client,
    closes: stock ? stock.bars : null,
    priceIssue: price.issue,
    priceBasis: price.basis,
    benchmark: bench ? bench.bars : null,
    benchmarkIssue: benchmarkSource.closes ? null : `BENCHMARK_${benchmarkSource.issue || 'NO_DATA'}`,
    benchmarkBasis: benchmarkSource.basis,
    calendarIssue,
    nowIso: deps.nowIso,
  });
  // A provider failure is visible as a 502; "not covered" is a normal 200 with every metric UNAVAILABLE.
  return { status: loaded.coverage === 'PROVIDER_FAILURE' ? 502 : 200, body: loaded };
}

/** Split-adjusted, dividend-UNADJUSTED daily closes (the `quote` series, never `adjclose`), oldest first. */
export async function fetchYahooPriceHistory(
  symbol: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PriceHistory> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${PRICE_HISTORY_YEARS}y`;
  try {
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; options-screener/1.0)', Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return { closes: null, issue: `PRICE_HTTP_${res.status}`, basis: PRICE_BASIS_QUOTE };
    const data = (await res.json()) as {
      chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] };
    };
    const result = data && data.chart && data.chart.result && data.chart.result[0];
    if (!result) return { closes: null, issue: 'PRICE_NO_DATA', basis: PRICE_BASIS_QUOTE };
    const timestamps = result.timestamp || [];
    const closesRaw = (result.indicators && result.indicators.quote && result.indicators.quote[0] && result.indicators.quote[0].close) || [];
    const bars: DailyBar[] = [];
    let last = -Infinity;
    for (let i = 0; i < timestamps.length; i += 1) {
      const c = closesRaw[i];
      const t = timestamps[i];
      if (c != null && Number.isFinite(c) && c > 0 && Number.isFinite(t) && t > last) {
        bars.push({ t, c });
        last = t;
      }
    }
    return bars.length > 0 ? { closes: bars, issue: null, basis: PRICE_BASIS_QUOTE } : { closes: null, issue: 'PRICE_NO_DATA', basis: PRICE_BASIS_QUOTE };
  } catch (_err) {
    return { closes: null, issue: 'PRICE_FETCH_FAILED', basis: PRICE_BASIS_QUOTE };
  }
}
