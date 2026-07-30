import type { MarketFeatureSet, MovingAverageEvidence, PointInTimeBar } from './types';

const pct = (current: number, prior: number): number | null => prior === 0 ? null : (current - prior) / prior;
const avg = (values: readonly number[]): number | null => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

function movingAverage(bars: readonly PointInTimeBar[], lookback: number): MovingAverageEvidence {
  if (bars.length < lookback) return { lookback, value: null, priorValue: null, slope: null };
  const closes = bars.map(bar => bar.c);
  const value = avg(closes.slice(-lookback));
  const priorValue = bars.length >= lookback * 2 ? avg(closes.slice(-(lookback * 2), -lookback)) : null;
  return { lookback, value, priorValue, slope: value != null && priorValue != null ? pct(value, priorValue) : null };
}

function returnOver(bars: readonly PointInTimeBar[], lookback: number): number | null {
  if (bars.length <= lookback) return null;
  return pct(bars[bars.length - 1].c, bars[bars.length - 1 - lookback].c);
}

export function calculateMarketFeatures(bars: readonly PointInTimeBar[]): MarketFeatureSet {
  if (!bars.length) throw new Error('Market features require at least one OHLC bar');
  const currentPrice = bars[bars.length - 1].c;
  const last60 = bars.slice(-60);
  const last20 = bars.slice(-20);
  const rangeHigh = last60.length ? Math.max(...last60.map(bar => bar.h)) : null;
  const rangeLow = last60.length ? Math.min(...last60.map(bar => bar.l)) : null;
  const rangeWidth = rangeHigh != null && rangeLow != null ? rangeHigh - rangeLow : null;

  return {
    currentPrice,
    range60WidthPct: rangeWidth != null && currentPrice !== 0 ? rangeWidth / currentPrice : null,
    range60Position: rangeWidth != null && rangeWidth > 0 && rangeLow != null ? (currentPrice - rangeLow) / rangeWidth : null,
    swing20High: last20.length ? Math.max(...last20.map(bar => bar.h)) : null,
    swing20Low: last20.length ? Math.min(...last20.map(bar => bar.l)) : null,
    ma20: movingAverage(bars, 20),
    ma50: movingAverage(bars, 50),
    ma200: movingAverage(bars, 200),
    returns: {
      10: returnOver(bars, 10),
      20: returnOver(bars, 20),
      40: returnOver(bars, 40),
      60: returnOver(bars, 60),
      90: returnOver(bars, 90),
    },
  };
}
