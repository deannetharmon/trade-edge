import { TrendBias, UnderlyingMetrics } from "@/types/screener";

export function classifyTrendBias(m: Omit<UnderlyingMetrics, 'trendBias'>): TrendBias {
  const isAbove20 = m.price > m.sma20;
  const isAbove50 = m.price > m.sma50;
  const isAbove200 = m.price > m.sma200;

  const maStackedBull = m.sma20 > m.sma50 && m.sma50 > m.sma200;
  const maStackedBear = m.sma20 < m.sma50 && m.sma50 < m.sma200;

  if (isAbove20 && isAbove50 && isAbove200 && maStackedBull && m.rsi >= 55) {
    return 'STRONG_BULLISH';
  }

  if (isAbove50 && isAbove200 && (!isAbove20 || (m.rsi >= 45 && m.rsi < 55))) {
    return 'WEAK_BULLISH';
  }

  if (!isAbove20 && !isAbove50 && !isAbove200 && maStackedBear && m.rsi <= 45) {
    return 'STRONG_BEARISH';
  }

  if (!isAbove50 && (isAbove200 || m.rsi < 45)) {
    return 'WEAK_BEARISH';
  }

  return 'SIDEWAYS';
}
