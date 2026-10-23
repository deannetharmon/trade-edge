// lib/fundamentals/cachedPriceHistory.ts
//
// DATA-CACHE-0001: shared-cache wrapper around the server-side Yahoo closes fetch used by /api/fundamentals and /api/qv-feasibility.
// Short TTL on purpose: the handler drops a still-forming trailing bar by the exchange calendar, so a long-lived entry holding a
// mid-session bar would later be read as a completed session. Ten minutes bounds that. Only a clean result (closes present, no issue)
// is cached; failures and empty histories always refetch.

import { cachedJson } from '@/lib/cache/sharedCache';
import { fetchYahooPriceHistory, PRICE_HISTORY_YEARS } from './handler';
import type { PriceHistory } from './handler';

export const PRICE_HISTORY_CACHE_TTL_SECONDS = 600;

export function fetchYahooPriceHistoryCached(symbol: string): Promise<PriceHistory> {
  return cachedJson<PriceHistory>(`yahoo-closes:${PRICE_HISTORY_YEARS}y:${symbol.toUpperCase()}`, PRICE_HISTORY_CACHE_TTL_SECONDS, async () => {
    const value = await fetchYahooPriceHistory(symbol);
    return { value, cacheable: value.closes !== null && value.issue === null };
  });
}
