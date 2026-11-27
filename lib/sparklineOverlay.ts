// lib/sparklineOverlay.ts
//
// SPARKLINES-0002: leveraged ETF underlying overlay on the quick chart. Display only: nothing here feeds a score, verdict or order.
// The map holds the fund's underlying and its stated daily leverage (negative = inverse). Only funds Dean can verify on the
// issuer's page belong here; a symbol that is not listed gets no overlay and no caption.

export interface LeverageInfo {
  underlying: string;
  leverage: number;
}

export const LEVERAGED_UNDERLYING: Record<string, LeverageInfo> = {
  // Single-stock funds (same underlyings as lib/leveragedEtfs.ts LEVERAGED_SINGLE_STOCK_UNDERLYING)
  NVDL: { underlying: 'NVDA', leverage: 2 }, NVDU: { underlying: 'NVDA', leverage: 2 }, NVDX: { underlying: 'NVDA', leverage: 2 }, NVDD: { underlying: 'NVDA', leverage: -2 },
  TSLL: { underlying: 'TSLA', leverage: 2 }, TSLT: { underlying: 'TSLA', leverage: 2 }, TSLQ: { underlying: 'TSLA', leverage: -2 }, TSLS: { underlying: 'TSLA', leverage: -1 },
  MSFU: { underlying: 'MSFT', leverage: 2 }, AAPU: { underlying: 'AAPL', leverage: 2 }, AMZU: { underlying: 'AMZN', leverage: 2 }, AMZD: { underlying: 'AMZN', leverage: -1 },
  GGLL: { underlying: 'GOOGL', leverage: 2 }, GGLS: { underlying: 'GOOGL', leverage: -1 }, METU: { underlying: 'META', leverage: 2 }, PLTU: { underlying: 'PLTR', leverage: 2 },
  MULL: { underlying: 'MU', leverage: 2 }, AMDL: { underlying: 'AMD', leverage: 2 }, CONL: { underlying: 'COIN', leverage: 2 },
  MSTX: { underlying: 'MSTR', leverage: 2 }, MSTZ: { underlying: 'MSTR', leverage: -2 },
  // Index and sector funds (the fund's own index is followed through the matching unleveraged ETF)
  TQQQ: { underlying: 'QQQ', leverage: 3 }, SQQQ: { underlying: 'QQQ', leverage: -3 }, QLD: { underlying: 'QQQ', leverage: 2 }, QID: { underlying: 'QQQ', leverage: -2 },
  UPRO: { underlying: 'SPY', leverage: 3 }, SPXL: { underlying: 'SPY', leverage: 3 }, SPXU: { underlying: 'SPY', leverage: -3 }, SPXS: { underlying: 'SPY', leverage: -3 },
  SSO: { underlying: 'SPY', leverage: 2 }, SDS: { underlying: 'SPY', leverage: -2 },
  UDOW: { underlying: 'DIA', leverage: 3 }, SDOW: { underlying: 'DIA', leverage: -3 },
  TNA: { underlying: 'IWM', leverage: 3 }, TZA: { underlying: 'IWM', leverage: -3 },
  SOXL: { underlying: 'SOXX', leverage: 3 }, SOXS: { underlying: 'SOXX', leverage: -3 },
};

export const leverageInfoFor = (symbol: string): LeverageInfo | null => LEVERAGED_UNDERLYING[symbol.trim().toUpperCase()] ?? null;

/** "2x of NVDA", "-3x of QQQ". */
export const leverageCaption = (info: LeverageInfo): string => `${info.leverage}x of ${info.underlying}`;

export interface RebasedPair {
  etf: number[];
  underlying: number[];
}

/**
 * Both series as % change from their first shared point, so they sit on one scale. The two lists are aligned by their LAST
 * point (both are the most recent daily closes), and the longer one is trimmed to the shorter. Returns null when either list is
 * too short or its first shared close is not a positive number, so the caller falls back to the plain chart.
 */
export function rebasePair(etfCloses: number[], underlyingCloses: number[]): RebasedPair | null {
  const n = Math.min(etfCloses.length, underlyingCloses.length);
  if (n < 2) return null;
  const etf = etfCloses.slice(-n);
  const underlying = underlyingCloses.slice(-n);
  if (!(etf[0] > 0) || !(underlying[0] > 0)) return null;
  if (etf.some(v => !Number.isFinite(v)) || underlying.some(v => !Number.isFinite(v))) return null;
  return {
    etf: etf.map(v => (v / etf[0] - 1) * 100),
    underlying: underlying.map(v => (v / underlying[0] - 1) * 100),
  };
}
