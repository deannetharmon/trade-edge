import { OptionContract } from "@/types/screener";

export async function fetchOptionChainFromProvider(symbol: string): Promise<OptionContract[]> {
  try {
    const baseUrl = process.env.MARKET_DATA_API_URL || 'https://api.tastyworks.com';
    const response = await fetch(`${baseUrl}/option-chains/${symbol}/nested`, {
      headers: {
        'Authorization': `Bearer ${process.env.MARKET_DATA_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      next: { revalidate: 60 },
    });

    if (!response.ok) {
      console.error(`Failed to fetch chain for ${symbol}: ${response.statusText}`);
      return [];
    }

    const payload = await response.json();
    const rawItems: any[] = payload.data?.items || payload.items || [];

    return rawItems.map((item) => {
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
  } catch (error) {
    console.error(`Error in fetchOptionChainFromProvider for ${symbol}:`, error);
    return [];
  }
}
