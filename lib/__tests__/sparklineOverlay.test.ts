// lib/__tests__/sparklineOverlay.test.ts
//
// SPARKLINES-0002: the leveraged ETF map and the shared-scale rebasing behind the quick-chart overlay.

import { describe, expect, it } from 'vitest';
import { LEVERAGED_UNDERLYING, leverageCaption, leverageInfoFor, rebasePair } from '../sparklineOverlay';
import { isLeveragedEtf } from '../leveragedEtfs';
import { underlyingStockFor } from '../leveragedEtfs';

describe('leverageInfoFor', () => {
  it('maps a single-stock fund and an index fund, case and space tolerant', () => {
    expect(leverageInfoFor('NVDL')).toEqual({ underlying: 'NVDA', leverage: 2 });
    expect(leverageInfoFor(' tqqq ')).toEqual({ underlying: 'QQQ', leverage: 3 });
  });
  it('returns null for an unleveraged ticker or an unlisted fund', () => {
    expect(leverageInfoFor('AAPL')).toBeNull();
    expect(leverageInfoFor('LABU')).toBeNull();
  });
  it('captions read like "2x of NVDA" and "-3x of QQQ"', () => {
    expect(leverageCaption({ underlying: 'NVDA', leverage: 2 })).toBe('2x of NVDA');
    expect(leverageCaption({ underlying: 'QQQ', leverage: -3 })).toBe('-3x of QQQ');
  });
  it('every mapped fund is on the shared leveraged list, and agrees with the earnings-underlying map where both have it', () => {
    for (const [symbol, info] of Object.entries(LEVERAGED_UNDERLYING)) {
      expect(isLeveragedEtf(symbol), `${symbol} missing from LEVERAGED_OR_INVERSE`).toBe(true);
      const earningsUnderlying = underlyingStockFor(symbol);
      if (earningsUnderlying) expect(info.underlying, symbol).toBe(earningsUnderlying);
      expect(info.leverage).not.toBe(0);
    }
  });
});

describe('rebasePair', () => {
  it('rebases both series to % change from the first point', () => {
    const pair = rebasePair([50, 55, 60], [100, 105, 110])!;
    expect(pair.etf[0]).toBe(0);
    expect(pair.etf[2]).toBeCloseTo(20, 6);
    expect(pair.underlying[2]).toBeCloseTo(10, 6);
  });
  it('aligns by the most recent points when one fund is newer', () => {
    const pair = rebasePair([10, 11], [100, 102, 104, 108])!;
    expect(pair.etf).toHaveLength(2);
    expect(pair.underlying).toHaveLength(2);
    expect(pair.underlying[0]).toBe(0);
    expect(pair.underlying[1]).toBeCloseTo((108 / 104 - 1) * 100, 6);
  });
  it('returns null for too little data or a bad first value, so the plain chart is drawn', () => {
    expect(rebasePair([10], [100, 101])).toBeNull();
    expect(rebasePair([10, 11], [])).toBeNull();
    expect(rebasePair([0, 11], [100, 101])).toBeNull();
    expect(rebasePair([10, Number.NaN], [100, 101])).toBeNull();
  });
});
