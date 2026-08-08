export type MarketDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNCERTAIN';
export type MarketRegime = 'TREND' | 'RANGE' | 'TRANSITION' | 'CHAOTIC';
export type TrendMaturity = 'EMERGING' | 'ESTABLISHED' | 'EXTENDED' | 'DETERIORATING';

export interface PointInTimeBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

export interface PointInTimeMarketData {
  symbol: string;
  asOf: string;
  bars: readonly PointInTimeBar[];
  source: string;
}

export interface MovingAverageEvidence {
  lookback: number;
  value: number | null;
  priorValue: number | null;
  slope: number | null;
}

export interface MarketFeatureSet {
  currentPrice: number;
  range60WidthPct: number | null;
  range60Position: number | null;
  swing20High: number | null;
  swing20Low: number | null;
  ma20: MovingAverageEvidence;
  ma50: MovingAverageEvidence;
  ma200: MovingAverageEvidence;
  returns: Readonly<Record<10 | 20 | 40 | 60 | 90, number | null>>;
}

export interface MarketStateEvidence {
  direction: MarketDirection;
  strength: number | null;
  persistence: number | null;
  regime: MarketRegime;
  maturity: TrendMaturity;
  uncertainty: number | null;
  features: MarketFeatureSet;
  supportingEvidence: readonly string[];
  contradictingEvidence: readonly string[];
}
