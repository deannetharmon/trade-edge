// lib/research/__tests__/yahooChart.test.ts

import { describe, expect, it } from 'vitest';
import { RESEARCH_RANGES, RESEARCH_RANGE_ORDER, chartGapBoxes, chartGeometry, chartLevelLines, dayChange, isResearchRange, normalizeResearchSymbol, parseResearchChart, rangeChange, tradingViewLevelString } from '../yahooChart';

const payload = {
  chart: { result: [{
    meta: { longName: 'Apple Inc.', regularMarketPrice: 200, chartPreviousClose: 195, fiftyTwoWeekHigh: 220, fiftyTwoWeekLow: 150, regularMarketVolume: 5_000_000, currency: 'USD' },
    timestamp: [1, 2, 3, 4],
    indicators: { quote: [{ close: [190, null, 198, 200] }] },
  }] },
};

describe('RESEARCH-0001 yahoo chart helpers', () => {
  it('parses points (dropping null closes) and headline stats', () => {
    const r = parseResearchChart(payload, 'AAPL')!;
    expect(r.points).toEqual([{ t: 1, c: 190 }, { t: 3, c: 198 }, { t: 4, c: 200 }]);
    expect(r.meta).toMatchObject({ symbol: 'AAPL', name: 'Apple Inc.', price: 200, previousClose: 195, fiftyTwoWeekHigh: 220, fiftyTwoWeekLow: 150, volume: 5_000_000 });
  });
  it('returns null for an empty or malformed payload', () => {
    expect(parseResearchChart({ chart: { result: null } }, 'X')).toBeNull();
    expect(parseResearchChart(null, 'X')).toBeNull();
  });
  it('validates symbols and ranges', () => {
    expect(normalizeResearchSymbol(' nvda ')).toBe('NVDA');
    expect(normalizeResearchSymbol('BRK.B')).toBe('BRK.B');
    expect(normalizeResearchSymbol('^VIX')).toBe('^VIX');
    expect(normalizeResearchSymbol('')).toBeNull();
    expect(normalizeResearchSymbol('A B')).toBeNull();
    expect(normalizeResearchSymbol('../etc')).toBeNull();
    expect(normalizeResearchSymbol(undefined)).toBeNull();
    expect(RESEARCH_RANGE_ORDER.every(isResearchRange)).toBe(true);
    expect(RESEARCH_RANGE_ORDER).toContain('6M');
    expect(RESEARCH_RANGES['6M']).toMatchObject({ range: '6mo', interval: '1d' });
    expect(isResearchRange('10Y')).toBe(false);
    expect(isResearchRange('toString')).toBe(false);
    expect(RESEARCH_RANGES['1D']).toMatchObject({ range: '1d', interval: '5m' });
  });
  it('computes day and range changes', () => {
    expect(dayChange(200, 195)).toEqual({ amount: 5, pct: (5 / 195) * 100 });
    expect(dayChange(null, 195)).toBeNull();
    expect(dayChange(200, 0)).toBeNull();
    expect(rangeChange([{ t: 1, c: 100 }, { t: 2, c: 110 }])).toEqual({ amount: 10, pct: 10 });
    expect(rangeChange([{ t: 1, c: 100 }])).toBeNull();
  });
  it('builds chart geometry: x spans the width, the high is at the top', () => {
    const g = chartGeometry([{ t: 1, c: 10 }, { t: 2, c: 20 }, { t: 3, c: 15 }], 100, 50, 0)!;
    expect(g.xs).toEqual([0, 50, 100]);
    expect(g.ys[1]).toBe(0);
    expect(g.ys[0]).toBe(50);
    expect(chartGeometry([{ t: 1, c: 1 }], 100, 50)).toBeNull();
  });
});

describe('RESEARCH-0007 chart level lines', () => {
  const pts = [{ t: 1, c: 100 }, { t: 2, c: 200 }];
  it('puts each level at the same y the price line uses, drops levels off the chart, and merges lines that would overlap', () => {
    const g = chartGeometry(pts, 800, 260)!;
    const lines = chartLevelLines(pts, [
      { price: 100, kind: 'support', label: 'Support' },
      { price: 150, kind: 'resistance', label: 'Resistance' },
      { price: 150.5, kind: 'extreme', label: '20-day high' },
      { price: 226, kind: 'extreme', label: '52-week high' },
      { price: 90, kind: 'extreme', label: '52-week low' },
    ], 260);
    expect(lines.map(l => l.label)).toEqual(['Support', 'Resistance']);
    expect(lines[0].y).toBeCloseTo(g.ys[0], 10);
    expect(lines[1].y).toBeCloseTo(130, 10);
    expect(chartLevelLines([{ t: 1, c: 1 }], [{ price: 1, kind: 'support', label: 'x' }], 260)).toEqual([]);
  });
});

describe('RESEARCH-0008 chart gap boxes', () => {
  it('starts at the gap bar, runs to the right edge, clips to the visible price range, and drops zones off the chart', () => {
    const pts = [{ t: 10, c: 100 }, { t: 20, c: 150 }, { t: 30, c: 200 }];
    const boxes = chartGapBoxes(pts, [
      { bottom: 120, top: 130, t: 20, side: 'below' },
      { bottom: 190, top: 230, t: 10, side: 'above' },
      { bottom: 250, top: 260, t: 10, side: 'above' },
    ], 800, 260);
    expect(boxes).toHaveLength(2);
    expect(boxes[0].x).toBeCloseTo(400, 10);
    expect(boxes[0].y1).toBeLessThan(boxes[0].y2);
    expect(boxes[1].x).toBe(0);
    expect(boxes[1].y1).toBeCloseTo(4, 10);
  });
});

describe('TV-LEVELS-0001 TradingView level string', () => {
  it('encodes lines as S/R/X plus price and gaps as G side bottom:top:time, every level included', () => {
    expect(tradingViewLevelString(
      [{ price: 193.384, kind: 'support', label: 'Support' }, { price: 198.5, kind: 'resistance', label: 'Resistance' }, { price: 226.88, kind: 'extreme', label: '52-week high' }],
      [{ bottom: 96, top: 98.256, t: 1700000000, side: 'below' }, { bottom: 300, top: 310, t: 1700086400, side: 'above' }],
    )).toBe('S193.38;R198.50;X226.88;GB96.00:98.26:1700000000;GA300.00:310.00:1700086400');
    expect(tradingViewLevelString([], [])).toBe('');
  });
});
