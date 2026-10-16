// lib/scans/__tests__/ccScanOrderInput.test.ts

import { describe, expect, it } from 'vitest';
import { ccOrderInputFromScanResult } from '../ccScanOrderInput';
import type { ScreenResult } from '../types';

function result(over: Record<string, unknown> = {}, resultOver: Record<string, unknown> = {}): ScreenResult {
  return {
    symbol: 'BITX', strategy: 'CC', price: 15, ivr: null, qualified: true, failReasons: [], checks: {},
    underlyingType: 'etf',
    bestCandidate: {
      strategy: 'CC', expiration: '2026-11-06', dte: 22, shortStrike: 16, longStrike: 16, shortDelta: 0.27, credit: 80,
      spreadWidth: 0, creditRatio: 0, roc: 0, pop: 70, shortOI: 500, longOI: 500,
      shortOccSymbol: 'BITX  261106C00016000', ccPremiumPerShare: 0.4, ...over,
    },
    ...resultOver,
  } as unknown as ScreenResult;
}

describe('ccOrderInputFromScanResult', () => {
  it('maps a covered-call scan result and keeps the contract count the card showed', () => {
    expect(ccOrderInputFromScanResult(result())).toEqual({
      symbol: 'BITX', occSymbol: 'BITX  261106C00016000', strike: 16, expiration: '2026-11-06', dte: 22,
      delta: 0.27, midPerShare: 0.4, isIndex: false, initialQuantity: 2,
    });
  });
  it('marks index underlyings', () => {
    expect(ccOrderInputFromScanResult(result({}, { underlyingType: 'index' }))!.isIndex).toBe(true);
  });
  it('refuses anything that is not an orderable covered call', () => {
    expect(ccOrderInputFromScanResult(result({ strategy: 'CSP' }))).toBeNull();
    expect(ccOrderInputFromScanResult(result({ ccPremiumPerShare: undefined }))).toBeNull();
    expect(ccOrderInputFromScanResult(result({ ccPremiumPerShare: 0 }))).toBeNull();
    expect(ccOrderInputFromScanResult(result({ shortOccSymbol: undefined }))).toBeNull();
    expect(ccOrderInputFromScanResult(result({ shortStrike: 0 }))).toBeNull();
    expect(ccOrderInputFromScanResult({ ...result(), bestCandidate: null } as ScreenResult)).toBeNull();
  });
  it('never sizes below one contract', () => {
    expect(ccOrderInputFromScanResult(result({ credit: 0.5 }))!.initialQuantity).toBe(1);
  });
});
