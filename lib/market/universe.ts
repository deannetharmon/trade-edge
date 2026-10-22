// lib/market/universe.ts
//
// MARKET-MAP-0001: which stocks the Market Map draws, their sector, and an APPROXIMATE market cap in $ billions. Caps set only the
// relative tile size: they are rounded estimates, not live figures, and drift over time (refresh this list by hand each quarter).
// The Dow 30 is price-weighted, so its tiles are sized by live share price instead. This is the largest names, not the whole index:
// the S&P 500 view covers 94 stocks, the Nasdaq view the largest 31. Russell 2000 has no list yet.

export type SectorName =
  | 'Technology' | 'Communication Services' | 'Consumer Cyclical' | 'Financial Services' | 'Healthcare'
  | 'Consumer Defensive' | 'Energy' | 'Industrials' | 'Utilities' | 'Real Estate' | 'Basic Materials';

export interface StockInfo { sector: SectorName; /** Approximate market cap, $ billions. */ cap: number }

export const STOCKS: Record<string, StockInfo> = {
  'NVDA': { sector: 'Technology', cap: 4600 },
  'AAPL': { sector: 'Technology', cap: 4000 },
  'MSFT': { sector: 'Technology', cap: 3700 },
  'AVGO': { sector: 'Technology', cap: 1600 },
  'ORCL': { sector: 'Technology', cap: 700 },
  'PLTR': { sector: 'Technology', cap: 430 },
  'AMD': { sector: 'Technology', cap: 330 },
  'MU': { sector: 'Technology', cap: 250 },
  'CRM': { sector: 'Technology', cap: 250 },
  'CSCO': { sector: 'Technology', cap: 280 },
  'IBM': { sector: 'Technology', cap: 270 },
  'INTC': { sector: 'Technology', cap: 150 },
  'QCOM': { sector: 'Technology', cap: 170 },
  'TXN': { sector: 'Technology', cap: 170 },
  'AMAT': { sector: 'Technology', cap: 170 },
  'NOW': { sector: 'Technology', cap: 190 },
  'ADBE': { sector: 'Technology', cap: 150 },
  'INTU': { sector: 'Technology', cap: 180 },
  'LRCX': { sector: 'Technology', cap: 190 },
  'KLAC': { sector: 'Technology', cap: 150 },
  'ANET': { sector: 'Technology', cap: 160 },
  'PANW': { sector: 'Technology', cap: 130 },
  'CRWD': { sector: 'Technology', cap: 120 },
  'ACN': { sector: 'Technology', cap: 160 },
  'GOOGL': { sector: 'Communication Services', cap: 2100 },
  'GOOG': { sector: 'Communication Services', cap: 2000 },
  'META': { sector: 'Communication Services', cap: 1700 },
  'NFLX': { sector: 'Communication Services', cap: 480 },
  'TMUS': { sector: 'Communication Services', cap: 260 },
  'DIS': { sector: 'Communication Services', cap: 200 },
  'VZ': { sector: 'Communication Services', cap: 190 },
  'T': { sector: 'Communication Services', cap: 190 },
  'AMZN': { sector: 'Consumer Cyclical', cap: 2400 },
  'TSLA': { sector: 'Consumer Cyclical', cap: 1000 },
  'HD': { sector: 'Consumer Cyclical', cap: 380 },
  'MCD': { sector: 'Consumer Cyclical', cap: 220 },
  'LOW': { sector: 'Consumer Cyclical', cap: 140 },
  'BKNG': { sector: 'Consumer Cyclical', cap: 170 },
  'TJX': { sector: 'Consumer Cyclical', cap: 160 },
  'NKE': { sector: 'Consumer Cyclical', cap: 100 },
  'SBUX': { sector: 'Consumer Cyclical', cap: 110 },
  'BRK-B': { sector: 'Financial Services', cap: 1050 },
  'JPM': { sector: 'Financial Services', cap: 800 },
  'V': { sector: 'Financial Services', cap: 650 },
  'MA': { sector: 'Financial Services', cap: 520 },
  'BAC': { sector: 'Financial Services', cap: 350 },
  'WFC': { sector: 'Financial Services', cap: 270 },
  'GS': { sector: 'Financial Services', cap: 230 },
  'MS': { sector: 'Financial Services', cap: 230 },
  'AXP': { sector: 'Financial Services', cap: 220 },
  'C': { sector: 'Financial Services', cap: 190 },
  'BLK': { sector: 'Financial Services', cap: 170 },
  'SCHW': { sector: 'Financial Services', cap: 170 },
  'TRV': { sector: 'Financial Services', cap: 60 },
  'LLY': { sector: 'Healthcare', cap: 800 },
  'JNJ': { sector: 'Healthcare', cap: 450 },
  'UNH': { sector: 'Healthcare', cap: 300 },
  'ABBV': { sector: 'Healthcare', cap: 380 },
  'MRK': { sector: 'Healthcare', cap: 250 },
  'PFE': { sector: 'Healthcare', cap: 150 },
  'TMO': { sector: 'Healthcare', cap: 210 },
  'ABT': { sector: 'Healthcare', cap: 220 },
  'AMGN': { sector: 'Healthcare', cap: 170 },
  'ISRG': { sector: 'Healthcare', cap: 190 },
  'GILD': { sector: 'Healthcare', cap: 140 },
  'MRNA': { sector: 'Healthcare', cap: 72 },
  'WMT': { sector: 'Consumer Defensive', cap: 800 },
  'COST': { sector: 'Consumer Defensive', cap: 420 },
  'PG': { sector: 'Consumer Defensive', cap: 380 },
  'KO': { sector: 'Consumer Defensive', cap: 300 },
  'PEP': { sector: 'Consumer Defensive', cap: 200 },
  'PM': { sector: 'Consumer Defensive', cap: 250 },
  'MO': { sector: 'Consumer Defensive', cap: 100 },
  'XOM': { sector: 'Energy', cap: 480 },
  'CVX': { sector: 'Energy', cap: 280 },
  'COP': { sector: 'Energy', cap: 130 },
  'GE': { sector: 'Industrials', cap: 300 },
  'CAT': { sector: 'Industrials', cap: 280 },
  'RTX': { sector: 'Industrials', cap: 220 },
  'HON': { sector: 'Industrials', cap: 140 },
  'UNP': { sector: 'Industrials', cap: 140 },
  'BA': { sector: 'Industrials', cap: 140 },
  'LMT': { sector: 'Industrials', cap: 110 },
  'DE': { sector: 'Industrials', cap: 130 },
  'UPS': { sector: 'Industrials', cap: 90 },
  'UBER': { sector: 'Industrials', cap: 190 },
  'MMM': { sector: 'Industrials', cap: 90 },
  'NEE': { sector: 'Utilities', cap: 150 },
  'SO': { sector: 'Utilities', cap: 100 },
  'DUK': { sector: 'Utilities', cap: 95 },
  'PLD': { sector: 'Real Estate', cap: 100 },
  'AMT': { sector: 'Real Estate', cap: 90 },
  'LIN': { sector: 'Basic Materials', cap: 210 },
  'SHW': { sector: 'Basic Materials', cap: 90 },
};

export type IndexKey = 'spx' | 'dji' | 'ixic';

export interface IndexDef {
  key: IndexKey;
  label: string;
  /** 'cap' sizes tiles by approximate market cap; 'price' by live share price (the Dow). */
  weighting: 'cap' | 'price';
  tickers: string[];
  /** Plain-language scope shown under the map. */
  scope: string;
}

export const INDEXES: IndexDef[] = [
  { key: 'spx', label: 'S&P 500', weighting: 'cap', tickers: ['NVDA', 'AAPL', 'MSFT', 'AVGO', 'ORCL', 'PLTR', 'AMD', 'MU', 'CRM', 'CSCO', 'IBM', 'INTC', 'QCOM', 'TXN', 'AMAT', 'NOW', 'ADBE', 'INTU', 'LRCX', 'KLAC', 'ANET', 'PANW', 'CRWD', 'ACN', 'GOOGL', 'GOOG', 'META', 'NFLX', 'TMUS', 'DIS', 'VZ', 'T', 'AMZN', 'TSLA', 'HD', 'MCD', 'LOW', 'BKNG', 'TJX', 'NKE', 'SBUX', 'BRK-B', 'JPM', 'V', 'MA', 'BAC', 'WFC', 'GS', 'MS', 'AXP', 'C', 'BLK', 'SCHW', 'TRV', 'LLY', 'JNJ', 'UNH', 'ABBV', 'MRK', 'PFE', 'TMO', 'ABT', 'AMGN', 'ISRG', 'GILD', 'MRNA', 'WMT', 'COST', 'PG', 'KO', 'PEP', 'PM', 'MO', 'XOM', 'CVX', 'COP', 'GE', 'CAT', 'RTX', 'HON', 'UNP', 'BA', 'LMT', 'DE', 'UPS', 'MMM', 'NEE', 'SO', 'DUK', 'PLD', 'AMT', 'LIN', 'SHW', 'UBER'], scope: 'Largest 94 stocks in the S&P 500 (not all 500).' },
  { key: 'dji', label: 'Dow 30', weighting: 'price', tickers: ['AAPL', 'AMGN', 'AMZN', 'AXP', 'BA', 'CAT', 'CRM', 'CSCO', 'CVX', 'DIS', 'GS', 'HD', 'HON', 'IBM', 'JNJ', 'JPM', 'KO', 'MCD', 'MMM', 'MRK', 'MSFT', 'NKE', 'NVDA', 'PG', 'SHW', 'TRV', 'UNH', 'V', 'VZ', 'WMT'], scope: 'All 30 Dow stocks, sized by share price like the index.' },
  { key: 'ixic', label: 'Nasdaq', weighting: 'cap', tickers: ['NVDA', 'AAPL', 'MSFT', 'AMZN', 'META', 'GOOGL', 'GOOG', 'AVGO', 'TSLA', 'COST', 'NFLX', 'AMD', 'PLTR', 'CSCO', 'TMUS', 'INTU', 'QCOM', 'TXN', 'AMGN', 'ADBE', 'AMAT', 'ISRG', 'BKNG', 'PANW', 'LRCX', 'MU', 'KLAC', 'ANET', 'CRWD', 'GILD', 'SBUX'], scope: 'Largest 31 Nasdaq-100 stocks.' },
];

/** TastyTrade's symbol for a ticker, when it differs from the common one. */
export const BROKER_SYMBOL_ALIASES: Record<string, string> = { 'BRK-B': 'BRK/B' };
export const brokerSymbol = (ticker: string): string => BROKER_SYMBOL_ALIASES[ticker] ?? ticker;
