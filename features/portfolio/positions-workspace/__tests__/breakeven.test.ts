import { describe, expect, it } from 'vitest';
import type { Position } from '@/lib/portfolio-data/types';
import { buildBreakevenViewModel, buildLongOptionOutlook, priceBufferFor } from '../model/breakeven';

const position = (overrides: Partial<Position> = {}): Position => ({
  key: 'p1', symbol: 'TEST', strategy: 'CSP', quantity: 1, structureAmbiguous: false,
  entryPriceEffect: 'Credit', entryEconomicsComplete: true, entryCredit: 100,
  legs: [{ symbol: 'put', optionType: 'P', strikePrice: 50, direction: 'Short', quantity: 1, avgOpenPrice: 1, currentPrice: 0.5 , currentDelta: null}],
  ...overrides,
} as Position);

describe('Portfolio breakeven presentation model', () => {
  it('uses canonical whole-position credit for CSP and Bull Put Spread', () => {
    expect(buildBreakevenViewModel(position()).values).toEqual([49]);
    expect(buildBreakevenViewModel(position({ strategy: 'BPS', entryCredit: 150, legs: [
      { symbol: 'short', optionType: 'P', strikePrice: 50, direction: 'Short', quantity: 1, avgOpenPrice: 2, currentPrice: 1 , currentDelta: null},
      { symbol: 'long', optionType: 'P', strikePrice: 45, direction: 'Long', quantity: 1, avgOpenPrice: 0.5, currentPrice: 0.2 , currentDelta: null},
    ] })).values).toEqual([48.5]);
  });

  it('computes Bear Call Spread and both Iron Condor breakevens', () => {
    expect(buildBreakevenViewModel(position({ strategy: 'BCS', entryCredit: 125, legs: [
      { symbol: 'short', optionType: 'C', strikePrice: 50, direction: 'Short', quantity: 1, avgOpenPrice: 2, currentPrice: 1 , currentDelta: null},
      { symbol: 'long', optionType: 'C', strikePrice: 55, direction: 'Long', quantity: 1, avgOpenPrice: 0.75, currentPrice: 0.2 , currentDelta: null},
    ] })).values).toEqual([51.25]);
    expect(buildBreakevenViewModel(position({ strategy: 'IC', entryCredit: 150, legs: [
      { symbol: 'lp', optionType: 'P', strikePrice: 40, direction: 'Long', quantity: 1, avgOpenPrice: 0.2, currentPrice: 0.1 , currentDelta: null},
      { symbol: 'sp', optionType: 'P', strikePrice: 45, direction: 'Short', quantity: 1, avgOpenPrice: 1, currentPrice: 0.5 , currentDelta: null},
      { symbol: 'sc', optionType: 'C', strikePrice: 55, direction: 'Short', quantity: 1, avgOpenPrice: 1, currentPrice: 0.5 , currentDelta: null},
      { symbol: 'lc', optionType: 'C', strikePrice: 60, direction: 'Long', quantity: 1, avgOpenPrice: 0.3, currentPrice: 0.1 , currentDelta: null},
    ] })).values).toEqual([43.5, 56.5]);
  });

  it('does not fabricate PMCC or missing-entry breakevens', () => {
    expect(buildBreakevenViewModel(position({ strategy: 'PMCC', entryPriceEffect: 'Debit' }))).toMatchObject({ values: [], unavailableReason: expect.stringMatching(/PMCC/) });
    expect(buildBreakevenViewModel(position({ entryEconomicsComplete: false, entryCredit: null }))).toMatchObject({ values: [], unavailableReason: expect.stringMatching(/Opening/) });
    expect(buildBreakevenViewModel(position({ strategy: 'CC', legs: [{ symbol: 'call', optionType: 'C', strikePrice: 55, direction: 'Short', quantity: 1, avgOpenPrice: 1, currentPrice: 0.5 , currentDelta: null}] }))).toMatchObject({ values: [], unavailableReason: expect.stringMatching(/cost basis/) });
  });

  it('long put: breakeven is strike minus debit per share (the 140P at $25.74 -> $114.26)', () => {
    const vm = buildBreakevenViewModel(position({ strategy: 'PUT', entryPriceEffect: 'Debit', entryCredit: 2574, legs: [
      { symbol: 'lp', optionType: 'P', strikePrice: 140, direction: 'Long', quantity: 1, avgOpenPrice: 25.74, currentPrice: 3.57, currentDelta: null },
    ] }));
    expect(vm.values[0]).toBeCloseTo(114.26, 9);
    expect(vm.favorable).toBe('DOWN');
  });

  it('Price Buffer is measured in the direction that hurts the position (Ian)', () => {
    // short put 75.5, credit 2.20, stock 83.55: cushion 10.25 (12.3%)
    const csp = buildBreakevenViewModel(position({ entryCredit: 220, legs: [{ symbol: 'sp', optionType: 'P', strikePrice: 75.5, direction: 'Short', quantity: 1, avgOpenPrice: 2.2, currentPrice: 2.12, currentDelta: null }] }));
    expect(priceBufferFor(csp, 83.55)!.dollars).toBeCloseTo(10.25, 9);
    expect(priceBufferFor(csp, 83.55)!.pct).toBeCloseTo(12.268, 2);
    // bear call spread breakeven 51.25: stock 49 is SAFE (+2.25), stock 53 is PAST breakeven (-1.75)
    const bcs = buildBreakevenViewModel(position({ strategy: 'BCS', entryCredit: 125, legs: [
      { symbol: 'short', optionType: 'C', strikePrice: 50, direction: 'Short', quantity: 1, avgOpenPrice: 2, currentPrice: 1, currentDelta: null },
      { symbol: 'long', optionType: 'C', strikePrice: 55, direction: 'Long', quantity: 1, avgOpenPrice: 0.75, currentPrice: 0.2, currentDelta: null },
    ] }));
    expect(priceBufferFor(bcs, 49)!.dollars).toBeCloseTo(2.25, 9);
    expect(priceBufferFor(bcs, 53)!.dollars).toBeCloseTo(-1.75, 9);
    // long call 70C, debit 20.85, stock 67.86: 22.99 short of breakeven
    const lc = buildBreakevenViewModel(position({ strategy: 'CALL', entryPriceEffect: 'Debit', entryCredit: 2085, legs: [{ symbol: 'lc', optionType: 'C', strikePrice: 70, direction: 'Long', quantity: 1, avgOpenPrice: 20.85, currentPrice: 10.65, currentDelta: null }] }));
    expect(priceBufferFor(lc, 67.86)!.dollars).toBeCloseTo(-22.99, 9);
    // long put 140P, breakeven 114.26, stock 206.27: 92.01 above breakeven -> negative buffer
    const lp = buildBreakevenViewModel(position({ strategy: 'PUT', entryPriceEffect: 'Debit', entryCredit: 2574, legs: [{ symbol: 'lp', optionType: 'P', strikePrice: 140, direction: 'Long', quantity: 1, avgOpenPrice: 25.74, currentPrice: 3.57, currentDelta: null }] }));
    expect(priceBufferFor(lp, 206.27)!.dollars).toBeCloseTo(-92.01, 9);
    // Iron condor: two breakevens, no single buffer
    expect(priceBufferFor({ values: [43.5, 56.5], unavailableReason: null, favorable: null }, 50)).toBeNull();
  });
});

// LONG-OUTLOOK-0001: the expected odds below were computed independently (exact normal CDF in Python, zero drift,
// calendar DTE / 365, symbol IV), not with the app's own approximation.
describe('LONG-OUTLOOK-0001: bought call / put outlook', () => {
  const nflx = (overrides: Partial<Position> = {}): Position => position({
    symbol: 'NFLX', strategy: 'CALL', entryPriceEffect: 'Debit', entryCredit: 2085, stockPrice: 72.74, dte: 337, iv: 48,
    legs: [{ symbol: 'lc', optionType: 'C', strikePrice: 70, direction: 'Long', quantity: 1, avgOpenPrice: 20.85, currentPrice: 13.48, currentDelta: null }],
    ...overrides,
  });

  it('NFLX 70C bought at 20.85: needs $18.11 (24.9%) to the $90.85 breakeven, 13% of the way there, odds match the independent values', () => {
    const o = buildLongOptionOutlook(nflx())!;
    expect(o.direction).toBe('UP');
    expect(o.breakeven).toBeCloseTo(90.85, 9);
    expect(o.gapDollars).toBeCloseTo(18.11, 9);
    expect(o.gapPct).toBeCloseTo(24.897, 2);
    expect(o.breakevenReached).toBe(false);
    expect(o.rangeProgress).toBeCloseTo(0.13141, 4);
    expect(o.popStrike).toBeCloseTo(44.1423, 2);
    expect(o.popBreakeven).toBeCloseTo(23.8037, 2);
  });

  it('uses the stock\'s own IV: a lower IV moves both odds the way the independent calc says', () => {
    const o = buildLongOptionOutlook(nflx({ iv: 44 }))!;
    expect(o.popStrike).toBeCloseTo(45.2013, 2);
    expect(o.popBreakeven).toBeCloseTo(23.049, 2);
  });

  it('long put 140P bought at 25.74: the stock must fall, so the odds are the chance of finishing BELOW', () => {
    const o = buildLongOptionOutlook(position({
      symbol: 'PUTT', strategy: 'PUT', entryPriceEffect: 'Debit', entryCredit: 2574, stockPrice: 206.27, dte: 100, iv: 40,
      legs: [{ symbol: 'lp', optionType: 'P', strikePrice: 140, direction: 'Long', quantity: 1, avgOpenPrice: 25.74, currentPrice: 3.57, currentDelta: null }],
    }))!;
    expect(o.direction).toBe('DOWN');
    expect(o.breakeven).toBeCloseTo(114.26, 9);
    expect(o.gapDollars).toBeCloseTo(92.01, 9);
    expect(o.breakevenReached).toBe(false);
    expect(o.rangeProgress).toBe(0); // stock is above the strike, so no progress toward the lower breakeven
    expect(o.popStrike).toBeCloseTo(4.0378, 2);
    expect(o.popBreakeven).toBeCloseTo(0.3297, 2);
  });

  it('once the stock is past breakeven the gap is not positive and the bar is full', () => {
    const o = buildLongOptionOutlook(nflx({ stockPrice: 95 }))!;
    expect(o.breakevenReached).toBe(true);
    expect(o.gapDollars).toBeCloseTo(-4.15, 9);
    expect(o.gapPct!).toBeLessThan(0);
    expect(o.rangeProgress).toBe(1);
  });

  it('keeps the distance but shows no odds when IV or DTE is missing', () => {
    const o = buildLongOptionOutlook(nflx({ iv: null }))!;
    expect(o.gapDollars).toBeCloseTo(18.11, 9);
    expect(o.popStrike).toBeNull();
    expect(o.popBreakeven).toBeNull();
    expect(buildLongOptionOutlook(nflx({ dte: 0 }))!.popBreakeven).toBeNull();
  });

  it('is null for everything that is not a standalone bought option: credit positions, debit spreads, a missing stock price', () => {
    expect(buildLongOptionOutlook(position())).toBeNull();
    expect(buildLongOptionOutlook(nflx({ stockPrice: null }))).toBeNull();
    expect(buildLongOptionOutlook(nflx({ legs: [
      { symbol: 'lc', optionType: 'C', strikePrice: 70, direction: 'Long', quantity: 1, avgOpenPrice: 20.85, currentPrice: 13.48, currentDelta: null },
      { symbol: 'sc', optionType: 'C', strikePrice: 90, direction: 'Short', quantity: 1, avgOpenPrice: 4, currentPrice: 3, currentDelta: null },
    ] }))).toBeNull();
    expect(buildLongOptionOutlook(nflx({ entryEconomicsComplete: false, entryCredit: null }))).toBeNull();
  });
});
