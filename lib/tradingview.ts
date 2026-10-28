// lib/tradingview.ts

// TV-LAYOUT-0001: every "open in TradingView" link goes to Dean's saved layout on tradingview.com with the ticker filled in, so his own
// indicators and drawings load. (TradingView's embeddable widget cannot load a saved layout, so it is no longer used.)

export const TRADINGVIEW_LAYOUT_ID = 'sdDzRlqf';

/** Index underlyings whose bare ticker TradingView would not resolve to the index itself. */
const TV_INDEX_SYMBOLS: Record<string, string> = {
  SPX: 'CBOE:SPX', SPXW: 'CBOE:SPX', NDX: 'NASDAQ:NDX', RUT: 'TVC:RUT', VIX: 'CBOE:VIX', DJX: 'TVC:DJI',
};

export function tradingViewSymbol(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  return TV_INDEX_SYMBOLS[s] ?? s;
}

/** The layout, with the ticker. A symbol that already names its exchange (CBOE:SPX) is passed through. */
export function buildTradingViewChartUrl(symbol: string): string {
  return `https://www.tradingview.com/chart/${TRADINGVIEW_LAYOUT_ID}/?symbol=${encodeURIComponent(tradingViewSymbol(symbol))}`;
}

/** The layout with whatever symbol it was last saved on (the header's TradingView link). */
export const TRADINGVIEW_LAYOUT_URL = `https://www.tradingview.com/chart/${TRADINGVIEW_LAYOUT_ID}/`;
