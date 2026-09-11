import { OptionContract } from "@/types/screener";

// In-memory option chain cache
const CACHE_TTL_MS = 60 * 1000; // 60-second fresh window
const chainCache = new Map<string, { timestamp: number; data: OptionContract[] }>();

/**
 * Fetches option chain for a single symbol with local memory caching.
 */
export async function fetchOptionChainFromProvider(symbol: string): Promise<OptionContract[]> {
  const now = Date.now();
  const cached = chainCache.get(symbol);

  // Return cached payload if still within TTL
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const baseUrl = process.env.MARKET_DATA_API_URL || 'https://api.tastyworks.com';
    const response = await fetch(`${baseUrl}/option-chains/${symbol}/nested`, {
      headers: {
        'Authorization': `Bearer ${process.env.MARKET_DATA_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`[Provider] HTTP ${response.status} fetching chain for ${symbol}`);
      return cached?.data || []; // Fallback to stale cache if API errors out
    }

    const payload = await response.json();
    const rawItems: any[] = payload.data?.items || payload.items || [];

    const contracts: OptionContract[] = rawItems.map((item) => {
      const bid = Number(item.bid || item.bid_price || 0);
      const ask = Number(item.ask || item.ask_price || 0);
      const mid = Number(item.mid || item.mid_price || (bid + ask) / 2);

      return {
        symbol: item.symbol,
        strike: Number(item.strike_price || item.strike),
        expiration: item.expiration_date || item.expiration,
        dte: Number(item.dte || item.days_to_expiration || 0),
        bid,
        ask,
        mid,
        delta: item.delta !== undefined ? Number(item.delta) : undefined,
        theta: item.theta !== undefined ? Number(item.theta) : undefined,
        vega: item.vega !== undefined ? Number(item.vega) : undefined,
        iv: item.implied_volatility !== undefined ? Number(item.implied_volatility) : undefined,
        openInterest: Number(item.open_interest || 0),
        volume: Number(item.volume || 0),
        type: (item.option_type || item.type || '').toLowerCase() === 'call' ? 'call' : 'put',
      };
    });

    // Update memory cache
    chainCache.set(symbol, { timestamp: now, data: contracts });
    return contracts;
  } catch (error) {
    console.error(`[Provider] Error fetching chain for ${symbol}:`, error);
    return cached?.data || [];
  }
}

/**
 * Batches array requests into concurrency chunks to respect API rate limits.
 */
export async function fetchOptionChainsConcurrently(
  symbols: string[],
  concurrencyLimit = 3,
  delayBetweenBatchesMs = 150
): Promise<Map<string, OptionContract[]>> {
  const results = new Map<string, OptionContract[]>();

  for (let i = 0; i < symbols.length; i += concurrencyLimit) {
    const chunk = symbols.slice(i, i + concurrencyLimit);
    
    const chunkResults = await Promise.all(
      chunk.map(async (symbol) => {
        const chain = await fetchOptionChainFromProvider(symbol);
        return { symbol, chain };
      })
    );

    for (const { symbol, chain } of chunkResults) {
      results.set(symbol, chain);
    }

    // Small throttle delay between batches to protect against burst limit enforcement
    if (i + concurrencyLimit < symbols.length && delayBetweenBatchesMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayBetweenBatchesMs));
    }
  }

  return results;
}
