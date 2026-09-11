import { OptionContract, UnderlyingMetrics } from "@/types/screener";
import { classifyTrendBias } from "@/lib/screener/trend";

const CACHE_TTL_MS = 60 * 1000;

interface CachedSymbolData {
  timestamp: number;
  contracts: OptionContract[];
  metrics?: UnderlyingMetrics;
}

const chainCache = new Map<string, CachedSymbolData>();

export async function fetchOptionChainFromProvider(symbol: string): Promise<{ contracts: OptionContract[]; metrics?: UnderlyingMetrics }> {
  const now = Date.now();
  const cached = chainCache.get(symbol);

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return { contracts: cached.contracts, metrics: cached.metrics };
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
      return { contracts: cached?.contracts || [] };
    }

    const payload = await response.json();
    const rawItems: any[] = payload.data?.items || payload.items || [];
    const underlyingPrice = Number(payload.data?.underlying_price || payload.underlying_price || rawItems[0]?.underlying_price || 0);

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

    const rsi = Number(payload.data?.rsi || payload.rsi || 50);
    const sma20 = Number(payload.data?.sma20 || underlyingPrice * 0.99);
    const sma50 = Number(payload.data?.sma50 || underlyingPrice * 0.97);
    const sma200 = Number(payload.data?.sma200 || underlyingPrice * 0.92);

    const trendBias = classifyTrendBias({
      price: underlyingPrice,
      sma20,
      sma50,
      sma200,
      rsi,
    });

    const metrics: UnderlyingMetrics = {
      price: underlyingPrice,
      sma20,
      sma50,
      sma200,
      rsi,
      trendBias,
    };

    chainCache.set(symbol, { timestamp: now, contracts, metrics });
    return { contracts, metrics };
  } catch (error) {
    console.error(`[Provider] Error fetching chain for ${symbol}:`, error);
    return { contracts: cached?.contracts || [] };
  }
}

export async function fetchOptionChainsConcurrently(
  symbols: string[],
  concurrencyLimit = 3,
  delayBetweenBatchesMs = 150
): Promise<Map<string, { contracts: OptionContract[]; metrics?: UnderlyingMetrics }>> {
  const results = new Map<string, { contracts: OptionContract[]; metrics?: UnderlyingMetrics }>();

  for (let i = 0; i < symbols.length; i += concurrencyLimit) {
    const chunk = symbols.slice(i, i + concurrencyLimit);

    const chunkResults = await Promise.all(
      chunk.map(async (symbol) => {
        const data = await fetchOptionChainFromProvider(symbol);
        return { symbol, data };
      })
    );

    for (const { symbol, data } of chunkResults) {
      results.set(symbol, data);
    }

    if (i + concurrencyLimit < symbols.length && delayBetweenBatchesMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayBetweenBatchesMs));
    }
  }

  return results;
}
