// features/portfolio/positions-workspace/__tests__/extrinsic.test.ts

import { describe, expect, it } from 'vitest';
import { buildValueSplit, type ValuePositionShape } from '../model/extrinsic';

const leg = (direction: 'Long' | 'Short', optionType: 'C' | 'P', strikePrice: number, avgOpenPrice: number | null, currentPrice: number | null) => ({ direction, optionType, strikePrice, avgOpenPrice, currentPrice });
const call = (over: Partial<ValuePositionShape> = {}, l: Record<string, unknown> = {}): ValuePositionShape => ({
  quantity: 1, stockPrice: 78.67, stockPriceAtEntry: 69.66,
  legs: [{ ...leg('Long', 'C', 67.5, 14.4, 13.63), ...l }],
  ...over,
});

describe('a bought call (LEAP): the value you own', () => {
  it('splits intrinsic and extrinsic now and at entry, with the change, the percent of value and the position total', () => {
    // now: intrinsic 11.17, extrinsic 2.46 ; entry: intrinsic 2.16, extrinsic 12.24
    const v = buildValueSplit(call())!;
    expect(v.side).toBe('long');
    expect(v.intrinsic.now).toBeCloseTo(11.17, 2);
    expect(v.intrinsic.atEntry).toBeCloseTo(2.16, 2);
    expect(v.intrinsic.change).toBeCloseTo(9.01, 2);
    expect(v.extrinsic.now).toBeCloseTo(2.46, 2);
    expect(v.extrinsic.atEntry).toBeCloseTo(12.24, 2);
    expect(v.extrinsic.change).toBeCloseTo(-9.78, 2);
    expect(v.extrinsicPctOfValue).toBeCloseTo((2.46 / 13.63) * 100, 4);
    expect(v.extrinsicTotalNow).toBeCloseTo(246, 2);
    expect(v.intrinsic.now + v.extrinsic.now).toBeCloseTo(13.63, 6); // the two parts add up to the price
  });
  it('scales the total by contracts, and an out-of-the-money call is all extrinsic', () => {
    expect(buildValueSplit(call({ quantity: 3 }))!.extrinsicTotalNow).toBeCloseTo(738, 2);
    const otm = buildValueSplit(call({ stockPrice: 60 }, { currentPrice: 4 }))!;
    expect(otm.extrinsic.now).toBe(4);
    expect(otm.intrinsic.now).toBe(0);
    expect(otm.extrinsicPctOfValue).toBe(100);
  });
});

describe('a bought put', () => {
  it('uses how far the stock is below the strike as intrinsic', () => {
    const v = buildValueSplit({ quantity: 1, stockPrice: 145.84, stockPriceAtEntry: 150, legs: [leg('Long', 'P', 140, 8, 5.58)] })!;
    expect(v.side).toBe('long');
    expect(v.extrinsic.now).toBeCloseTo(5.58, 2);
    expect(v.extrinsic.change).toBeCloseTo(-2.42, 2);
    expect(buildValueSplit({ quantity: 1, stockPrice: 130, stockPriceAtEntry: null, legs: [leg('Long', 'P', 140, 8, 11.5)] })!.extrinsic.now).toBeCloseTo(1.5, 2);
  });
});

describe('a sold option (CSP): the value you owe to close', () => {
  it('is on the short side, and extrinsic is what is left to earn', () => {
    const v = buildValueSplit({ quantity: 1, stockPrice: 200, stockPriceAtEntry: 210, entryPriceEffect: 'Credit', legs: [leg('Short', 'P', 175, 9.35, 9.1)] })!;
    expect(v.side).toBe('short');
    expect(v.intrinsic.now).toBe(0);
    expect(v.extrinsic.now).toBeCloseTo(9.1, 2);
    expect(v.extrinsic.atEntry).toBeCloseTo(9.35, 2);
    expect(v.extrinsic.change).toBeCloseTo(-0.25, 2);
  });
  it('in the money: intrinsic is what you would owe, extrinsic the rest', () => {
    const v = buildValueSplit({ quantity: 1, stockPrice: 170, stockPriceAtEntry: 200, entryPriceEffect: 'Credit', legs: [leg('Short', 'P', 175, 9.35, 7.2)] })!;
    expect(v.intrinsic.now).toBeCloseTo(5, 2);
    expect(v.extrinsic.now).toBeCloseTo(2.2, 2);
    expect(v.intrinsic.atEntry).toBe(0);
  });
  it('the side is decided by the entry credit or debit, and by the net price when that is unknown', () => {
    const put = [leg('Short', 'P', 175, 9.35, 9.1)];
    expect(buildValueSplit({ quantity: 1, stockPrice: 200, stockPriceAtEntry: null, legs: put })!.side).toBe('short');
    expect(buildValueSplit({ quantity: 1, stockPrice: 200, stockPriceAtEntry: null, entryPriceEffect: 'Unknown', legs: put })!.side).toBe('short');
  });
});

describe('a credit put spread', () => {
  const spread = (stock: number, shortNow: number, longNow: number): ValuePositionShape => ({
    quantity: 2, stockPrice: stock, stockPriceAtEntry: 180, entryPriceEffect: 'Credit',
    legs: [leg('Short', 'P', 175, 2.5, shortNow), leg('Long', 'P', 170, 1.0, longNow)],
  });
  it('nets the legs: out of the money it is all extrinsic and equals the cost to close', () => {
    const v = buildValueSplit(spread(178, 1.6, 0.6))!;
    expect(v.side).toBe('short');
    expect(v.intrinsic.now).toBe(0);
    expect(v.extrinsic.now).toBeCloseTo(1.0, 2); // 1.60 - 0.60
    expect(v.extrinsic.atEntry).toBeCloseTo(1.5, 2); // the credit, 2.50 - 1.00
    expect(v.extrinsic.change).toBeCloseTo(-0.5, 2);
    expect(v.extrinsicPctOfValue).toBeCloseTo(100, 4);
    expect(v.extrinsicTotalNow).toBeCloseTo(200, 2); // 1.00 x 100 x 2 contracts
  });
  it('with the short leg in the money, intrinsic is what you owe and the net extrinsic can be negative, shown as it is', () => {
    const v = buildValueSplit(spread(172, 3.0, 1.2))!; // owe 1.80 to close: intrinsic 3.00 - 0 = 3.00 ; extrinsic 0 - 1.20 = -1.20
    expect(v.intrinsic.now).toBeCloseTo(3.0, 2);
    expect(v.extrinsic.now).toBeCloseTo(-1.2, 2);
    expect(v.intrinsic.now + v.extrinsic.now).toBeCloseTo(1.8, 6);
    expect(v.extrinsicPctOfValue).toBeNull();
  });
});

describe('fails closed', () => {
  it('shows today but no "was" when the entry stock price or a premium is missing', () => {
    for (const bad of [call({ stockPriceAtEntry: null }), call({}, { avgOpenPrice: null })]) {
      const v = buildValueSplit(bad)!;
      expect(v.extrinsic.now).toBeCloseTo(2.46, 2);
      expect(v.extrinsic.atEntry).toBeNull();
      expect(v.extrinsic.change).toBeNull();
      expect(v.intrinsic.change).toBeNull();
    }
  });
  it('is null when today cannot be computed: no stock price, no mark, no strike, no legs, an odd direction', () => {
    expect(buildValueSplit(call({ stockPrice: null }))).toBeNull();
    expect(buildValueSplit(call({}, { currentPrice: null }))).toBeNull();
    expect(buildValueSplit(call({}, { strikePrice: undefined }))).toBeNull();
    expect(buildValueSplit(call({ stockPrice: 0 }))).toBeNull();
    expect(buildValueSplit({ ...call(), legs: [] })).toBeNull();
    expect(buildValueSplit(call({}, { direction: 'Sideways' }))).toBeNull();
    expect(buildValueSplit(call({}, { optionType: undefined }))).toBeNull();
  });
  it('a leg priced clearly under its intrinsic (a stale or crossed quote) is null, and a tiny shortfall rounds to zero', () => {
    expect(buildValueSplit(call({}, { currentPrice: 10 }))).toBeNull(); // 10 - 11.17
    expect(buildValueSplit(call({}, { currentPrice: 11.15 }))!.extrinsic.now).toBe(0); // -0.02, within tolerance
  });
});
