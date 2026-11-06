// lib/scans/__tests__/trendRsi.test.ts

import { describe, it, expect, vi, afterEach } from 'vitest';
import { trendRsiForDisplay } from '../trendRsi';
import { getTrend } from '../trend';
import { rsiSeries } from '@/lib/indicators/rsi';

describe('trendRsiForDisplay', () => {
  it('shows a real value, and never a made-up 50', () => {
    expect(trendRsiForDisplay({ rsi14: 65.2, rsi14Known: true })).toBe(65.2);
    expect(trendRsiForDisplay({ rsi14: 65.2 })).toBe(65.2); // older cached results without the flag
    expect(trendRsiForDisplay({ rsi14: 50, rsi14Known: false })).toBeNull();
    expect(trendRsiForDisplay(undefined)).toBeNull();
    expect(trendRsiForDisplay({ rsi14: Number.NaN })).toBeNull();
  });
});

describe('getTrend RSI (RSI-CARD-0001)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  // 120 daily bars ending at a past date (all completed), choppy rise so plain-average and Wilder differ.
  const bars = Array.from({ length: 120 }, (_, i) => ({
    t: Date.UTC(2026, 0, 2 + i) / 1000, o: 0, h: 0, l: 0,
    c: 90 + i * 0.1 + Math.sin(i / 2) * 3 + (i % 7 === 0 ? -2 : 0),
  }));

  it('uses Wilder RSI on completed bars, matching the indicator module', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ bars }) })));
    const trend = await getTrend('RSICARDZZ');
    const expected = rsiSeries(bars.map(b => b.c))!;
    expect(trend.metrics?.rsi14Known).toBe(true);
    expect(trend.metrics?.rsi14).toBeCloseTo(expected[expected.length - 1], 6);
  });
});
