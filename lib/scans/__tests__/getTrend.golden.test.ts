// lib/scans/__tests__/getTrend.golden.test.ts

// RSI-ENTRY-0001 slice A1b: getTrend now reads its bars through the shared memo. This pins its observable behavior
// (same request, same error text, same TrendResult) against output captured from the pre-change implementation.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTrend } from '../trend';
import { clearDailyBarsMemo } from '../dailyBarsMemo';
import golden from './getTrend.golden.json';

// Deterministic 130-bar series: a drift with a repeating wave, no randomness.
const bars = Array.from({ length: 130 }, (_, i) => {
  const c = 100 + i * 0.35 + Math.sin(i / 3) * 2.5 + (i % 7 === 0 ? -1.2 : 0.4);
  return { t: 1_760_000_000 + i * 86_400, o: c, h: c + 1, l: c - 1, c: Math.round(c * 100) / 100 };
});

function mockChart(body: unknown, status = 200) {
  const fn = vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => { clearDailyBarsMemo(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('getTrend through the bars memo', () => {
  it('returns the same TrendResult as before the change', async () => {
    mockChart({ bars });
    const result = await getTrend('AAPL', false);
    expect(JSON.parse(JSON.stringify(result))).toEqual(golden.stock);
  });
  it('index/ETF flag still changes the result the same way', async () => {
    mockChart({ bars });
    const result = await getTrend('SPY', true);
    expect(JSON.parse(JSON.stringify(result))).toEqual(golden.etf);
  });
  it('requests the same URL with no-store, mapping index symbols', async () => {
    const fn = mockChart({ bars });
    await getTrend('SPX', true);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('/api/chart?symbol=%5EGSPC', { cache: 'no-store' });
  });
  it('keeps the non-OK error text', async () => {
    mockChart({}, 502);
    await expect(getTrend('AAPL')).rejects.toThrow('Yahoo chart fetch failed for AAPL (502)');
  });
  it('keeps the too-few-closes error text', async () => {
    mockChart({ bars: bars.slice(0, 40) });
    await expect(getTrend('AAPL')).rejects.toThrow('no bars: AAPL returned only 40 closes — likely invalid symbol');
  });
  it('missing bars is the same too-few-closes error', async () => {
    mockChart({});
    await expect(getTrend('ZZZZ')).rejects.toThrow('no bars: ZZZZ returned only 0 closes — likely invalid symbol');
  });
});
