// features/portfolio/positions-workspace/__tests__/extrinsic.test.ts

import { describe, expect, it } from 'vitest';
import { buildExtrinsicView, type ExtrinsicPositionShape } from '../model/extrinsic';

const call = (over: Partial<ExtrinsicPositionShape> = {}, leg: Record<string, unknown> = {}): ExtrinsicPositionShape => ({
  quantity: 1, stockPrice: 78.67, stockPriceAtEntry: 69.66,
  legs: [{ direction: 'Long', optionType: 'C', strikePrice: 67.5, avgOpenPrice: 14.4, currentPrice: 13.63, ...leg }],
  ...over,
});

describe('buildExtrinsicView (a long call)', () => {
  it('computes extrinsic now and at entry, the change, the percent of value and the position total', () => {
    // now: 13.63 - (78.67 - 67.5 = 11.17) = 2.46 ; entry: 14.40 - (69.66 - 67.5 = 2.16) = 12.24
    const view = buildExtrinsicView(call())!;
    expect(view.now).toBeCloseTo(2.46, 2);
    expect(view.atEntry).toBeCloseTo(12.24, 2);
    expect(view.change).toBeCloseTo(-9.78, 2);
    expect(view.pctOfValue).toBeCloseTo((2.46 / 13.63) * 100, 4);
    expect(view.totalNow).toBeCloseTo(246, 2);
  });
  it('scales the total by contracts', () => {
    expect(buildExtrinsicView(call({ quantity: 3 }))!.totalNow).toBeCloseTo(738, 2);
  });
  it('an out-of-the-money call is all extrinsic', () => {
    const view = buildExtrinsicView(call({ stockPrice: 60 }, { currentPrice: 4 }))!;
    expect(view.now).toBe(4);
    expect(view.pctOfValue).toBe(100);
  });
});

describe('buildExtrinsicView (a long put)', () => {
  it('uses how far the stock is below the strike as intrinsic', () => {
    // strike 140, stock 145.84 -> intrinsic 0; put price 5.58 is all extrinsic. Entry: stock 150, paid 8.0 -> all extrinsic.
    const view = buildExtrinsicView({ quantity: 1, stockPrice: 145.84, stockPriceAtEntry: 150, legs: [{ direction: 'Long', optionType: 'P', strikePrice: 140, avgOpenPrice: 8, currentPrice: 5.58 }] })!;
    expect(view.now).toBeCloseTo(5.58, 2);
    expect(view.atEntry).toBeCloseTo(8, 2);
    expect(view.change).toBeCloseTo(-2.42, 2);
  });
  it('an in-the-money put: intrinsic is strike minus stock', () => {
    const view = buildExtrinsicView({ quantity: 1, stockPrice: 130, stockPriceAtEntry: null, legs: [{ direction: 'Long', optionType: 'P', strikePrice: 140, avgOpenPrice: 8, currentPrice: 11.5 }] })!;
    expect(view.now).toBeCloseTo(1.5, 2);
  });
});

describe('fails closed', () => {
  it('shows today but no "was" when the entry stock price or premium is missing', () => {
    for (const bad of [call({ stockPriceAtEntry: null }), call({}, { avgOpenPrice: null })]) {
      const view = buildExtrinsicView(bad)!;
      expect(view.now).toBeCloseTo(2.46, 2);
      expect(view.atEntry).toBeNull();
      expect(view.change).toBeNull();
    }
  });
  it('is null when today cannot be computed: no stock price, no mark, no strike', () => {
    expect(buildExtrinsicView(call({ stockPrice: null }))).toBeNull();
    expect(buildExtrinsicView(call({}, { currentPrice: null }))).toBeNull();
    expect(buildExtrinsicView(call({}, { strikePrice: undefined }))).toBeNull();
    expect(buildExtrinsicView(call({ stockPrice: 0 }))).toBeNull();
  });
  it('a clearly negative extrinsic (a stale or crossed quote) is null, and a tiny negative rounds to zero', () => {
    expect(buildExtrinsicView(call({}, { currentPrice: 10 }))).toBeNull(); // 10 - 11.17 = -1.17
    expect(buildExtrinsicView(call({}, { currentPrice: 11.15 }))!.now).toBe(0); // -0.02, within tolerance
  });
  it('is null for spreads, short options and anything that is not a single bought option', () => {
    expect(buildExtrinsicView(call({}, { direction: 'Short' }))).toBeNull();
    expect(buildExtrinsicView({ ...call(), legs: [call().legs[0], call().legs[0]] })).toBeNull();
    expect(buildExtrinsicView({ ...call(), legs: [] })).toBeNull();
    expect(buildExtrinsicView(call({}, { optionType: undefined }))).toBeNull();
  });
});
