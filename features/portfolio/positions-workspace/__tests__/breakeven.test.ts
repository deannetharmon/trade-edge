import { describe, expect, it } from 'vitest';
import type { Position } from '@/lib/portfolio-data/types';
import { buildBreakevenViewModel } from '../model/breakeven';

const position = (overrides: Partial<Position> = {}): Position => ({
  key: 'p1', symbol: 'TEST', strategy: 'CSP', quantity: 1, structureAmbiguous: false,
  entryPriceEffect: 'Credit', entryEconomicsComplete: true, entryCredit: 100,
  legs: [{ symbol: 'put', optionType: 'P', strikePrice: 50, direction: 'Short', quantity: 1, avgOpenPrice: 1, currentPrice: 0.5 }],
  ...overrides,
} as Position);

describe('Portfolio breakeven presentation model', () => {
  it('uses canonical whole-position credit for CSP and Bull Put Spread', () => {
    expect(buildBreakevenViewModel(position()).values).toEqual([49]);
    expect(buildBreakevenViewModel(position({ strategy: 'BPS', entryCredit: 150, legs: [
      { symbol: 'short', optionType: 'P', strikePrice: 50, direction: 'Short', quantity: 1, avgOpenPrice: 2, currentPrice: 1 },
      { symbol: 'long', optionType: 'P', strikePrice: 45, direction: 'Long', quantity: 1, avgOpenPrice: 0.5, currentPrice: 0.2 },
    ] })).values).toEqual([48.5]);
  });

  it('computes Bear Call Spread and both Iron Condor breakevens', () => {
    expect(buildBreakevenViewModel(position({ strategy: 'BCS', entryCredit: 125, legs: [
      { symbol: 'short', optionType: 'C', strikePrice: 50, direction: 'Short', quantity: 1, avgOpenPrice: 2, currentPrice: 1 },
      { symbol: 'long', optionType: 'C', strikePrice: 55, direction: 'Long', quantity: 1, avgOpenPrice: 0.75, currentPrice: 0.2 },
    ] })).values).toEqual([51.25]);
    expect(buildBreakevenViewModel(position({ strategy: 'IC', entryCredit: 150, legs: [
      { symbol: 'lp', optionType: 'P', strikePrice: 40, direction: 'Long', quantity: 1, avgOpenPrice: 0.2, currentPrice: 0.1 },
      { symbol: 'sp', optionType: 'P', strikePrice: 45, direction: 'Short', quantity: 1, avgOpenPrice: 1, currentPrice: 0.5 },
      { symbol: 'sc', optionType: 'C', strikePrice: 55, direction: 'Short', quantity: 1, avgOpenPrice: 1, currentPrice: 0.5 },
      { symbol: 'lc', optionType: 'C', strikePrice: 60, direction: 'Long', quantity: 1, avgOpenPrice: 0.3, currentPrice: 0.1 },
    ] })).values).toEqual([43.5, 56.5]);
  });

  it('does not fabricate PMCC or missing-entry breakevens', () => {
    expect(buildBreakevenViewModel(position({ strategy: 'PMCC', entryPriceEffect: 'Debit' }))).toMatchObject({ values: [], unavailableReason: expect.stringMatching(/PMCC/) });
    expect(buildBreakevenViewModel(position({ entryEconomicsComplete: false, entryCredit: null }))).toMatchObject({ values: [], unavailableReason: expect.stringMatching(/Opening/) });
    expect(buildBreakevenViewModel(position({ strategy: 'CC', legs: [{ symbol: 'call', optionType: 'C', strikePrice: 55, direction: 'Short', quantity: 1, avgOpenPrice: 1, currentPrice: 0.5 }] }))).toMatchObject({ values: [], unavailableReason: expect.stringMatching(/cost basis/) });
  });
});
