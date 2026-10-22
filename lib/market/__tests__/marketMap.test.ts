// lib/market/__tests__/marketMap.test.ts
// MARKET-MAP-0001: layout, color scale, "moving against you", holdings and quote parsing, with Dean's real positions as golden cases.
import { describe, expect, it } from 'vitest';
import { squarify } from '../treemap';
import { colorBucket, holdingLabel, movingAgainst, netExposure, parseOcc, pctChange } from '../marketMapMath';
import { buildHoldings } from '../holdings';
import { fetchStockQuotes, normalizeEquityItem } from '../marketQuotes';
import { INDEXES, STOCKS } from '../universe';

describe('squarify', () => {
  const rect = { x: 0, y: 0, w: 1000, h: 600 };
  const items = [40, 30, 20, 10, 5, 5, 3, 1].map((value, i) => ({ value, data: `t${i}` }));
  const placed = squarify(items, rect);
  it('places every positive item once, and areas add up to the container', () => {
    expect(placed).toHaveLength(items.length);
    const total = placed.reduce((s, p) => s + p.rect.w * p.rect.h, 0);
    expect(total).toBeCloseTo(1000 * 600, 3);
  });
  it('tile area is proportional to value', () => {
    const sum = items.reduce((s, i) => s + i.value, 0);
    for (const p of placed) expect(p.rect.w * p.rect.h).toBeCloseTo((p.item.value / sum) * 600000, 3);
  });
  it('no tile leaves the container and no two overlap', () => {
    for (const p of placed) {
      expect(p.rect.x).toBeGreaterThanOrEqual(-1e-6); expect(p.rect.y).toBeGreaterThanOrEqual(-1e-6);
      expect(p.rect.x + p.rect.w).toBeLessThanOrEqual(1000 + 1e-6); expect(p.rect.y + p.rect.h).toBeLessThanOrEqual(600 + 1e-6);
    }
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i].rect, b = placed[j].rect;
      const overlapW = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const overlapH = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      expect(overlapW > 1e-6 && overlapH > 1e-6).toBe(false);
    }
  });
  it('drops zero, negative and non-finite values; an empty or zero-size container places nothing', () => {
    expect(squarify([{ value: 0, data: 'a' }, { value: -1, data: 'b' }, { value: NaN, data: 'c' }], rect)).toEqual([]);
    expect(squarify(items, { x: 0, y: 0, w: 0, h: 10 })).toEqual([]);
  });
});

describe('pctChange and colorBucket', () => {
  it('computes from the previous close and refuses missing or non-positive inputs', () => {
    expect(pctChange(185.39, 245.81)).toBeCloseTo(-24.58, 1);
    expect(pctChange(null, 100)).toBeNull();
    expect(pctChange(100, 0)).toBeNull();
    expect(pctChange(100, undefined)).toBeNull();
  });
  it('uses the approved scale: -3 or worse is darkest red, +3 or better darkest green', () => {
    const cases: [number | null, string][] = [[-24.6, 'dn4'], [-3, 'dn4'], [-2.99, 'dn3'], [-2.5, 'dn3'], [-1.5, 'dn2'], [-0.2, 'dn1'], [0, 'flat'], [0.86, 'up1'], [1.94, 'up2'], [2.92, 'up3'], [4.44, 'up4'], [null, 'none']];
    for (const [pct, bucket] of cases) expect(colorBucket(pct)).toBe(bucket);
  });
});

describe('positions on a tile', () => {
  const nvdl = { 'instrument-type': 'Equity Option', symbol: 'NVDL  261120P00027000', 'underlying-symbol': 'NVDL', quantity: 1, 'quantity-direction': 'Short' };
  const mrna = { 'instrument-type': 'Equity Option', symbol: 'MRNA  261120P00140000', 'underlying-symbol': 'MRNA', quantity: 1, 'quantity-direction': 'Long' };
  it('parses an OCC symbol', () => {
    expect(parseOcc('NVDL  261120P00027000')).toEqual({ root: 'NVDL', kind: 'put', strike: 27 });
    expect(parseOcc('MRNA  261120P00140000')).toEqual({ root: 'MRNA', kind: 'put', strike: 140 });
    expect(parseOcc('AAPL  261120C00187500')).toEqual({ root: 'AAPL', kind: 'call', strike: 187.5 });
    expect(parseOcc('garbage')).toBeNull();
  });
  it('Dean: a short NVDL put shows on the NVDA tile, bullish; a long MRNA put is bearish', () => {
    const h = buildHoldings([nvdl, mrna]);
    expect(Array.from(h.keys()).sort()).toEqual(['MRNA', 'NVDA']);
    expect(h.get('NVDA')?.via).toBe('NVDL');
    expect(netExposure(h.get('NVDA')!)).toBe('bullish');
    expect(netExposure(h.get('MRNA')!)).toBe('bearish');
    expect(holdingLabel(h.get('NVDA')!)).toBe('Short 27P');
    expect(holdingLabel(h.get('MRNA')!)).toBe('Long 140P');
  });
  it('2x single-stock funds link to their stock (NVDL, MULL, METU); index funds like TQQQ stay on their own', () => {
    const put = (sym: string, root: string, dir: string) => ({ 'instrument-type': 'Equity Option', symbol: `${root.padEnd(6)}261120P00030000`, 'underlying-symbol': sym, quantity: 1, 'quantity-direction': dir });
    const h = buildHoldings([put('MULL', 'MULL', 'Short'), put('METU', 'METU', 'Short'), put('TQQQ', 'TQQQ', 'Short')]);
    expect(Array.from(h.keys()).sort()).toEqual(['META', 'MU', 'TQQQ']);
    expect(h.get('MU')?.via).toBe('MULL');
    expect(h.get('TQQQ')?.via).toBeNull();
  });
  it('moving against you: a big drop hurts the short put (NVDA -4.73%), a big rise hurts the long put, small moves flag nothing', () => {
    expect(movingAgainst('bullish', -4.73)).toBe(true);
    expect(movingAgainst('bullish', -1.9)).toBe(false);
    expect(movingAgainst('bullish', 3)).toBe(false);
    expect(movingAgainst('bearish', -24.6)).toBe(false);
    expect(movingAgainst('bearish', 2.5)).toBe(true);
    expect(movingAgainst('neutral', -10)).toBe(false);
    expect(movingAgainst('bullish', null)).toBe(false);
  });
  it('a put spread nets bullish when the short put is the bigger leg; an iron condor is neutral', () => {
    const bps = { legs: [{ kind: 'put' as const, side: 'short' as const, strike: 60, quantity: 1 }, { kind: 'put' as const, side: 'long' as const, strike: 55, quantity: 1 }], shares: 0 };
    expect(holdingLabel(bps)).toBe('Put spread');
    const condor = { legs: [
      { kind: 'put' as const, side: 'short' as const, strike: 60, quantity: 1 }, { kind: 'put' as const, side: 'long' as const, strike: 55, quantity: 1 },
      { kind: 'call' as const, side: 'short' as const, strike: 80, quantity: 1 }, { kind: 'call' as const, side: 'long' as const, strike: 85, quantity: 1 },
    ], shares: 0 };
    expect(holdingLabel(condor)).toBe('Iron condor');
    expect(netExposure(condor)).toBe('neutral');
  });
  it('ignores closed (zero-quantity) rows and short stock', () => {
    expect(buildHoldings([{ ...nvdl, quantity: 0 }, { 'instrument-type': 'Equity', symbol: 'XYZ', 'underlying-symbol': 'XYZ', quantity: 5, 'quantity-direction': 'Short' }]).size).toBe(0);
  });
});

describe('quotes', () => {
  it('reads last and prev-close from the broker item, falling back to mark then mid', () => {
    expect(normalizeEquityItem({ symbol: 'MRNA', last: '185.39', 'prev-close': '245.81' })).toEqual({ symbol: 'MRNA', last: 185.39, prevClose: 245.81 });
    expect(normalizeEquityItem({ symbol: 'X', mark: '10', 'prev-close': '9' }).last).toBe(10);
    expect(normalizeEquityItem({ symbol: 'X', bid: '9', ask: '11', 'prev-close': '9' }).last).toBe(10);
    expect(normalizeEquityItem({ symbol: 'X', last: '10' }).prevClose).toBeNull();
  });
  it('batches 100 tickers per request, maps BRK-B to the broker symbol, and counts what came back', async () => {
    const tickers = Array.from({ length: 230 }, (_, i) => `T${i}`).concat('BRK-B');
    const paths: string[] = [];
    const fetcher = async (path: string) => {
      paths.push(path);
      const symbols = path.split('&').map(p => decodeURIComponent(p.split('=')[1]));
      return { data: { items: symbols.filter(s => s !== 'T5').map(symbol => ({ symbol, last: '11', 'prev-close': '10' })) } };
    };
    const report = await fetchStockQuotes(tickers, fetcher);
    expect(paths).toHaveLength(3);
    expect(paths.some(p => p.includes('equity=BRK%2FB'))).toBe(true);
    expect(report).toMatchObject({ requested: 231, received: 230, withChange: 230, failedBatches: 0 });
    expect(report.quotes.get('BRK-B')?.pct).toBeCloseTo(10, 6);
    expect(report.quotes.get('T5')).toMatchObject({ last: null, pct: null });
  });
  it('a failed batch is counted and its tickers come back without a change, never as zero', async () => {
    const report = await fetchStockQuotes(['A', 'B'], async () => { throw new Error('boom'); });
    expect(report).toMatchObject({ received: 0, withChange: 0, failedBatches: 1 });
    expect(report.quotes.get('A')?.pct).toBeNull();
  });
});

describe('universe', () => {
  it('every ticker in every index has a sector and a cap', () => {
    for (const index of INDEXES) for (const t of index.tickers) expect(STOCKS[t], `${index.key} ${t}`).toBeDefined();
  });
  it('UBER (held) is on the S&P 500 map', () => {
    expect(INDEXES.find(i => i.key === 'spx')!.tickers).toContain('UBER');
  });
  it('the Dow has 30 names, each ticker appears once per index', () => {
    expect(INDEXES.find(i => i.key === 'dji')!.tickers).toHaveLength(30);
    for (const index of INDEXES) expect(new Set(index.tickers).size).toBe(index.tickers.length);
  });
});
