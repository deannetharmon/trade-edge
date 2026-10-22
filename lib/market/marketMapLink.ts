// lib/market/marketMapLink.ts
//
// MARKET-LINK-0001/0002: the market pages linked from order screens (Dean's Yahoo Finance addresses; stable quote pages, not session
// links). They open in a new tab: Yahoo cannot be shown inside TradeEdge.

export interface MarketLink { id: string; label: string; url: string }

export const MARKET_LINKS: MarketLink[] = [
  { id: 'spx', label: 'S&P 500', url: 'https://finance.yahoo.com/quote/%5EGSPC/' },
  { id: 'dji', label: 'Dow 30', url: 'https://finance.yahoo.com/quote/%5EDJI/' },
  { id: 'ixic', label: 'Nasdaq', url: 'https://finance.yahoo.com/quote/%5EIXIC/' },
  { id: 'rut', label: 'Russell 2000', url: 'https://finance.yahoo.com/quote/%5ERUT/' },
  { id: 'tnx', label: '10-year yield', url: 'https://finance.yahoo.com/quote/%5ETNX/' },
  { id: 'vix', label: 'VIX', url: 'https://finance.yahoo.com/quote/%5EVIX/' },
  { id: 'gold', label: 'Gold', url: 'https://finance.yahoo.com/quote/GC%3DF/' },
  { id: 'btc', label: 'Bitcoin', url: 'https://finance.yahoo.com/quote/BTC-USD/' },
];

export const MARKET_MAP_URL = MARKET_LINKS[0].url;
export const MARKET_MAP_LABEL = 'Markets ↗';
