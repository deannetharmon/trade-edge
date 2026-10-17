// lib/leveragedEtfs.ts
// Shared leveraged and inverse ETF list (Wheel exclusion, Portfolio concentration cluster). One list, two consumers.

export const LEVERAGED_OR_INVERSE = new Set([
  'TQQQ', 'SQQQ', 'SOXL', 'SOXS', 'UPRO', 'SPXU', 'SPXL', 'SPXS', 'SDS', 'SSO', 'QLD', 'QID', 'TNA', 'TZA', 'UDOW', 'SDOW',
  'TECL', 'TECS', 'FAS', 'FAZ', 'LABU', 'LABD', 'NUGT', 'DUST', 'JNUG', 'JDST', 'UVXY', 'SVXY', 'VXX', 'TSLL', 'TSLQ',
  'NVDL', 'NVDD', 'NVDX', 'FNGU', 'FNGD', 'BULZ', 'BERZ', 'YINN', 'YANG', 'ERX', 'ERY', 'UCO', 'SCO', 'BOIL', 'KOLD',
  'TMF', 'TMV', 'DPST', 'CURE', 'WEBL', 'WEBS', 'HIBL', 'HIBS', 'MSFU', 'AAPU', 'AMZU', 'GGLL', 'METU', 'PLTU', 'MULL',
  // Added 2026-09-26 after Dean's list (NAIL, CONL and BITX were missing): leveraged single-stock, crypto and sector funds.
  'NAIL', 'CONL', 'BITX', 'BITU', 'SBIT', 'ETHU', 'ETHD', 'MSTX', 'MSTZ', 'TSLT', 'TSLS', 'NVDU', 'AMDL', 'GGLS', 'AMZD', 'RETL', 'DFEN', 'WANT', 'HIBL', 'DRN', 'DRV', 'GUSH', 'DRIP',
]);

export const isLeveragedEtf = (symbol: string): boolean => LEVERAGED_OR_INVERSE.has(symbol.trim().toUpperCase());

/**
 * Leveraged single-stock funds and the stock they follow. Display only: the Portfolio shows the UNDERLYING's next earnings
 * date for these (an ETF has none of its own), and it never feeds a recommendation or a risk rule.
 */
export const LEVERAGED_SINGLE_STOCK_UNDERLYING: Record<string, string> = {
  TSLL: 'TSLA', TSLQ: 'TSLA', TSLT: 'TSLA', TSLS: 'TSLA',
  NVDL: 'NVDA', NVDD: 'NVDA', NVDX: 'NVDA', NVDU: 'NVDA',
  MSFU: 'MSFT', AAPU: 'AAPL', AMZU: 'AMZN', AMZD: 'AMZN', GGLL: 'GOOGL', GGLS: 'GOOGL',
  METU: 'META', PLTU: 'PLTR', MULL: 'MU', AMDL: 'AMD', CONL: 'COIN', MSTX: 'MSTR', MSTZ: 'MSTR',
};

export const underlyingStockFor = (symbol: string): string | null => LEVERAGED_SINGLE_STOCK_UNDERLYING[symbol.trim().toUpperCase()] ?? null;
