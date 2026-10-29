// lib/research/__tests__/researchVolume.test.ts

import { describe, expect, it } from 'vitest';
import { parseResearchChart } from '../yahooChart';
import { hasVolume, volumeBars } from '../researchVolume';

describe('RESEARCH-VOL-0001', () => {
  it('parses volume onto each point and leaves it off when Yahoo has none', () => {
    const data = { chart: { result: [{ timestamp: [1, 2, 3], indicators: { quote: [{ close: [10, 11, 12], volume: [100, null, 300] }] }, meta: {} }] } };
    const r = parseResearchChart(data, 'AAPL')!;
    expect(r.points).toEqual([{ t: 1, c: 10, v: 100 }, { t: 2, c: 11 }, { t: 3, c: 12, v: 300 }]);
  });

  it('knows when there is enough volume to draw', () => {
    expect(hasVolume([{ t: 1, c: 1 }, { t: 2, c: 1 }])).toBe(false);
    expect(hasVolume([{ t: 1, c: 1, v: 5 }, { t: 2, c: 1 }])).toBe(false);
    expect(hasVolume([{ t: 1, c: 1, v: 5 }, { t: 2, c: 1, v: 6 }])).toBe(true);
  });

  it('scales to the largest bar with a zero baseline and colors by close direction', () => {
    const bars = volumeBars([{ t: 1, c: 10, v: 100 }, { t: 2, c: 9, v: 400 }, { t: 3, c: 12, v: 200 }], 800, 82, 2);
    expect(bars).toHaveLength(3);
    // The largest bar fills the usable height; the others are proportional.
    expect(bars[1].height).toBeCloseTo(78, 5);
    expect(bars[0].height).toBeCloseTo(19.5, 5);
    expect(bars[1].y + bars[1].height).toBeCloseTo(80, 5);
    expect(bars.map(b => b.up)).toEqual([true, false, true]);
  });

  it('lines the bars up with the price chart and keeps them inside the panel', () => {
    const bars = volumeBars([{ t: 1, c: 1, v: 1 }, { t: 2, c: 1, v: 1 }, { t: 3, c: 1, v: 1 }], 800, 82);
    expect(bars[0].x).toBe(0);
    expect(bars[2].x + bars[2].width).toBeLessThanOrEqual(800);
    expect(bars[1].x + bars[1].width / 2).toBeCloseTo(400, 5);
  });

  it('skips points without a volume instead of drawing zero, and draws nothing for no volume at all', () => {
    expect(volumeBars([{ t: 1, c: 1, v: 5 }, { t: 2, c: 1 }, { t: 3, c: 1, v: 5 }], 800, 82)).toHaveLength(2);
    expect(volumeBars([{ t: 1, c: 1 }, { t: 2, c: 1 }], 800, 82)).toEqual([]);
    expect(volumeBars([{ t: 1, c: 1, v: 0 }, { t: 2, c: 1, v: 0 }], 800, 82)).toEqual([]);
  });
});
