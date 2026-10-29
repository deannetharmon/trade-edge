// lib/research/__tests__/researchRsi.test.ts

import { describe, expect, it } from 'vitest';
import { rsiSeries } from '@/lib/indicators/rsi';
import { rsiBarLabel, rsiForVisiblePoints, rsiNeedsLongerSource, rsiSegments, rsiY } from '../researchRsi';

const day = 86400;
const makePoints = (n: number, start = 1_700_000_000) => Array.from({ length: n }, (_, i) => ({ t: start + i * day, c: 100 + Math.sin(i / 3) * 5 + i * 0.2 }));

describe('RESEARCH-RSI-0001', () => {
  it('labels what one bar is on the intraday and weekly ranges only', () => {
    expect(rsiBarLabel('1D')).toBe('5m');
    expect(rsiBarLabel('1W')).toBe('30m');
    expect(rsiBarLabel('5Y')).toBe('weekly');
    for (const r of ['1M', '3M', '6M', '1Y'] as const) expect(rsiBarLabel(r)).toBeNull();
  });

  it('borrows a longer source only for the ranges shorter than the warm-up allows', () => {
    expect(['1M', '3M', '6M'].every(r => rsiNeedsLongerSource(r as never))).toBe(true);
    expect(rsiNeedsLongerSource('1Y')).toBe(false);
    expect(rsiNeedsLongerSource('5Y')).toBe(false);
  });

  it('matches the shared RSI(14) values to the visible points by timestamp', () => {
    const source = makePoints(100);
    const visible = source.slice(-21);
    const out = rsiForVisiblePoints(visible, source);
    const expected = rsiSeries(source.map(p => p.c))!;
    expect(out).toHaveLength(21);
    expect(out.every(v => v != null)).toBe(true);
    // The last visible point is the last source point, so it carries the last RSI value.
    expect(out[20]).toBeCloseTo(expected[expected.length - 1], 10);
    expect(out[0]).toBeCloseTo(expected[expected.length - 21], 10);
  });

  it('leaves early points empty when the source itself is too short to warm up', () => {
    const source = makePoints(20);
    const out = rsiForVisiblePoints(source, source);
    expect(out.slice(0, 14).every(v => v === null)).toBe(true);
    expect(out.slice(14).every(v => typeof v === 'number')).toBe(true);
  });

  it('returns all nulls for unusable closes instead of guessing', () => {
    const bad = [...makePoints(30)];
    bad[10] = { t: bad[10].t, c: 0 };
    expect(rsiForVisiblePoints(bad, bad).every(v => v === null)).toBe(true);
    expect(rsiForVisiblePoints(makePoints(5), makePoints(5)).every(v => v === null)).toBe(true);
  });

  it('draws one segment per run of values and breaks at gaps', () => {
    const segs = rsiSegments([null, 40, 50, null, 60, 62, 64], 600, 100);
    expect(segs).toHaveLength(2);
    expect(segs[0].points.split(' ')).toHaveLength(2);
    expect(segs[1].points.split(' ')).toHaveLength(3);
    expect(rsiSegments([50], 600, 100)).toEqual([]);
  });

  it('matches the price chart x positions and a fixed 0-100 scale', () => {
    const segs = rsiSegments([0, 100], 600, 100, 4);
    expect(segs[0].points).toBe('0.0,96.0 600.0,4.0');
    expect(rsiY(30, 100, 4)).toBeGreaterThan(rsiY(70, 100, 4));
    expect(rsiY(50, 100, 4)).toBeCloseTo(50, 5);
  });
});
