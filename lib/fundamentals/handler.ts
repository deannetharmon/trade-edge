// lib/fundamentals/handler.ts

// LEAPS-QV-0001 Gate 2b -- request handler behind /api/fundamentals. Dependencies are injected so the auth, validation,
// and error mapping are testable without the network. Server-side only (SEC and Yahoo are both reached from here).

import type { DailyBar } from '@/lib/discovery/normalized/technicals';
import { loadSecFundamentals, normalizeTicker } from './secFundamentals';
import type { LoadedFundamentals } from './secFundamentals';
import type { SecClient } from './sec/client';

export const PRICE_HISTORY_YEARS = 6;

export interface PriceHistory {
  readonly closes: readonly DailyBar[] | null;
  readonly issue: string | null;
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

  const price = await deps.fetchPriceHistory(symbol);
  const loaded = await loadSecFundamentals(symbol, {
    client: deps.client,
    closes: price.closes,
    priceIssue: price.issue,
    now: deps.nowIso(),
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
    if (!res.ok) return { closes: null, issue: `PRICE_HTTP_${res.status}` };
    const data = (await res.json()) as {
      chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] };
    };
    const result = data && data.chart && data.chart.result && data.chart.result[0];
    if (!result) return { closes: null, issue: 'PRICE_NO_DATA' };
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
    return bars.length > 0 ? { closes: bars, issue: null } : { closes: null, issue: 'PRICE_NO_DATA' };
  } catch (_err) {
    return { closes: null, issue: 'PRICE_FETCH_FAILED' };
  }
}
