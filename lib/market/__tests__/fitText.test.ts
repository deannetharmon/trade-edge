// lib/market/__tests__/fitText.test.ts
// MARKET-MAP-0003: whatever text is drawn must fit inside its tile; text that cannot fit is dropped, never clipped.
import { describe, expect, it } from 'vitest';
import { fitTileText, markerSize, MAX_TICKER_SIZE, MIN_TEXT_SIZE } from '../fitText';

// Mirror of the module's own estimate, so the tests check the promise, not the constants.
const CHAR_W = 0.7;
const LINE_H = 1.18;

describe('fitTileText', () => {
  it('a big tile gets the largest ticker size, and the percent and label as well', () => {
    const r = fitTileText({ w: 270, h: 280, ticker: 'NVDA', pct: '−4.39%', label: 'NVDL: Short 28P' });
    expect(r.ticker).toBe(MAX_TICKER_SIZE);
    expect(r.pct).not.toBeNull();
    expect(r.label).not.toBeNull();
  });
  it('the reported cases: MMM, NKE, MU with a label, and a four-letter ticker in a narrow tile', () => {
    for (const c of [
      { w: 78, h: 130, ticker: 'MMM', pct: '−1.41%' },
      { w: 24, h: 60, ticker: 'NKE', pct: '−2.29%' },
      { w: 62, h: 60, ticker: 'MU', pct: '−6.96%', label: 'MULL: Short 21P' },
      { w: 52, h: 40, ticker: 'KLAC', pct: '−10.05%' },
    ]) {
      const r = fitTileText(c);
      if (r.ticker != null) expect(r.ticker * CHAR_W * c.ticker.length).toBeLessThanOrEqual(c.w);
    }
  });
  it('whatever is returned fits the tile: width and height, for hundreds of sizes and texts', () => {
    const tickers = ['V', 'MU', 'AAPL', 'GOOGL', 'BRK-B', 'AMGN'];
    const pcts = ['+0.04%', '−4.39%', '−24.60%'];
    const labels = [null, 'Short 28P', 'NVDL: Short 28P', '3 option legs'];
    let checked = 0;
    for (let w = 14; w <= 400; w += 17) for (let h = 14; h <= 300; h += 19) for (const ticker of tickers) for (const pct of pcts) for (const label of labels) {
      const r = fitTileText({ w, h, ticker, pct, label });
      checked++;
      if (r.ticker == null) { expect(r.pct).toBeNull(); expect(r.label).toBeNull(); continue; }
      expect(r.ticker).toBeGreaterThanOrEqual(MIN_TEXT_SIZE);
      expect(r.ticker * CHAR_W * ticker.length).toBeLessThanOrEqual(w);
      let height = r.ticker * LINE_H;
      if (r.pct != null) { expect(r.pct * CHAR_W * pct.length).toBeLessThanOrEqual(w); height += r.pct * LINE_H; }
      if (r.label != null) { expect(r.label * CHAR_W * (label as string).length).toBeLessThanOrEqual(w); height += r.label * LINE_H; }
      expect(height).toBeLessThanOrEqual(h);
    }
    expect(checked).toBeGreaterThan(1000);
  });
  it('drops the label first, then the percent, before shrinking the ticker below readable', () => {
    const wide = fitTileText({ w: 120, h: 40, ticker: 'MU', pct: '−6.96%', label: 'MULL: Short 21P' });
    expect(wide.label).toBeNull();
    const short = fitTileText({ w: 200, h: 16, ticker: 'MU', pct: '−6.96%' });
    expect(short.pct).toBeNull();
  });
  it('a tile too small for any readable text gets none', () => {
    expect(fitTileText({ w: 6, h: 6, ticker: 'AAPL', pct: '+1.00%' })).toEqual({ ticker: null, pct: null, label: null });
    expect(fitTileText({ w: 0, h: 50, ticker: 'A', pct: '+1%' })).toEqual({ ticker: null, pct: null, label: null });
  });
});

describe('markerSize', () => {
  it('scales with the tile, is capped, and is absent on a tiny tile', () => {
    expect(markerSize(10, 10)).toBeNull();
    expect(markerSize(40, 40)).toBeCloseTo(11.2, 5);
    expect(markerSize(400, 400)).toBe(18);
  });
});
