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
