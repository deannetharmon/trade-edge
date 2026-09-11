export type TrendBias = 'STRONG_BULLISH' | 'WEAK_BULLISH' | 'SIDEWAYS' | 'WEAK_BEARISH' | 'STRONG_BEARISH';

export interface UnderlyingMetrics {
  price: number;
  sma20: number;
  sma50: number;
  sma200: number;
  rsi: number;
  adx?: number;
  trendBias: TrendBias;
}

export interface OptionContract {
  symbol: string;
  strike: number;
  expiration: string;
  dte: number;
  bid: number;
  ask: number;
  mid: number;
  delta?: number;
  theta?: number;
  vega?: number;
  iv?: number;
  openInterest: number;
  volume: number;
  type: 'call' | 'put';
}

export interface ScreenerParams {
  minVolume: number;
  minIVRank: number;
  maxIVRank: number;
  minDTE: number;
  maxDTE: number;
  maxSpreadWidthPct: number;
  requireGreeks: boolean;
  trendAlignedOnly?: boolean;
}

export interface CandidateResult<T> {
  underlying: string;
  strategyData: T;
  score: number;
  metrics: {
    spreadWidthPct: number;
    liquidityScore: number;
    pop: number;
    trendBias?: TrendBias;
  };
}

export interface ScreenerApiResponse<T> {
  success: boolean;
  count: number;
  data: CandidateResult<T>[];
  error?: string;
}
