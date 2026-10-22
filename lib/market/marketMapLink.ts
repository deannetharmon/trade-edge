// lib/market/marketMapLink.ts
//
// MARKET-LINK-0001: where the "Market map" link on order screens goes. Dean's Yahoo Finance S&P 500 page (^GSPC); a stable address, not a
// session link. It opens in a new tab: Yahoo cannot be shown inside TradeEdge.

export const MARKET_MAP_URL = 'https://finance.yahoo.com/quote/%5EGSPC/';
export const MARKET_MAP_LABEL = 'Market map ↗';
