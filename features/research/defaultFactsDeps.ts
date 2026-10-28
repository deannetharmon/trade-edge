// features/research/defaultFactsDeps.ts

// RESEARCH-0002: the real loaders behind the facts panel. Price facts come from our server route; trend and options context reuse the
// code the screener already runs in the browser (getTrend, TastyTrade market metrics), so there is no second definition of either.
import { getAccessToken, getMarketMetrics } from '@/lib/scans/tastytrade-client';
import { getTrend } from '@/lib/scans/trend';
import { ivToPercent } from '@/lib/ivUnits';
import type { ResearchFacts } from '@/lib/research/researchFacts';
import type { BrokerMetrics, ResearchFactsDeps } from './ResearchFacts';

export function defaultResearchFactsDeps(doFetch: typeof fetch): ResearchFactsDeps {
  return {
    async loadFacts(symbol) {
      const res = await doFetch(`/api/research-facts?symbol=${encodeURIComponent(symbol)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? 'Facts unavailable');
      return body as ResearchFacts;
    },
    async loadBroker(symbol): Promise<BrokerMetrics | null> {
      try {
        const token = await getAccessToken();
        const [m] = await getMarketMetrics([symbol], token);
        if (!m) return null;
        // One unit rule (lib/ivUnits): both volatilities become percent numbers, and the gap is computed here from those two.
        const iv = ivToPercent(m.ivx30);
        const hv = ivToPercent(m.hv30);
        return {
          ivRank: m.ivRank ?? null, ivx30: iv, hv30: hv, ivHvDiff: iv != null && hv != null ? iv - hv : null,
          earningsExpectedDate: m.earningsExpectedDate ?? null, liquidityRating: m.liquidityRating ?? null,
        };
      } catch { return null; }
    },
    async loadTrend(symbol) {
      try { return await getTrend(symbol); } catch { return null; }
    },
  };
}
