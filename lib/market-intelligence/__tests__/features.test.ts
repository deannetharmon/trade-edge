import { describe, expect, it } from 'vitest';
import { calculateMarketFeatures } from '../features';
import type { PointInTimeBar } from '../types';

const bars: PointInTimeBar[] = Array.from({ length: 200 }, (_, i) => ({ t: i, o: 100 + i, h: 105 + i, l: 95 + i, c: 100 + i }));

describe('calculateMarketFeatures', () => {
  it('uses actual OHLC highs and lows for swing structure', () => {
    const features = calculateMarketFeatures(bars);
    expect(features.swing20High).toBe(304);
    expect(features.swing20Low).toBe(275);
  });

  it('keeps range width and range position as distinct semantics', () => {
    const features = calculateMarketFeatures(bars);
    expect(features.range60WidthPct).not.toBe(features.range60Position);
    expect(features.range60Position).toBeGreaterThan(0);
    expect(features.range60Position).toBeLessThanOrEqual(1);
  });

  it('does not masquerade insufficient history as MA200', () => {
    const features = calculateMarketFeatures(bars.slice(-90));
    expect(features.ma200.lookback).toBe(200);
    expect(features.ma200.value).toBeNull();
  });
});
