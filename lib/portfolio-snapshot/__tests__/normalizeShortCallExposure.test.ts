// lib/portfolio-snapshot/__tests__/normalizeShortCallExposure.test.ts
// LCC-0001A PR 2 — short-call exposure normalization tests (ported logic, relocated module).
import { describe, it, expect } from 'vitest';
import { normalizeShortCallExposure, type RawPositionLike } from '../normalizeShortCallExposure';

const shortCall = (symbol: string, qty: number, optionType: 'P' | 'C' | null = 'C'): RawPositionLike => ({
  'instrument-type': 'Equity Option',
  'underlying-symbol': symbol,
  symbol: `${symbol}250101${optionType ?? 'C'}00100000`,
  ...(optionType != null ? { 'option-type': optionType } : {}),
  quantity: qty,
  'quantity-direction': 'Short',
});

const longCall = (symbol: string, qty: number): RawPositionLike => ({
  'instrument-type': 'Equity Option',
  'underlying-symbol': symbol,
  symbol: `${symbol}250101C00100000`,
  'option-type': 'C',
  quantity: qty,
  'quantity-direction': 'Long',
});

describe('normalizeShortCallExposure', () => {
  it('flags an adjusted contract deliverable so capacity fails closed', () => {
    const result = normalizeShortCallExposure([{ 'instrument-type': 'Equity Option', 'underlying-symbol': 'AAPL', 'option-type': 'C', 'quantity-direction': 'Short', quantity: 1, multiplier: 150 }]);
    expect(result.hasAdjustedOrUnknownDeliverable).toBe(true);
  });
  it('sums short call contracts per underlying', () => {
    const result = normalizeShortCallExposure([shortCall('AAPL', 1), shortCall('AAPL', 1)]);
    expect(result.bySymbol.AAPL).toBe(2);
    expect(result.hasUnattributableExposure).toBe(false);
  });

  it('never counts long calls as exposure', () => {
    const result = normalizeShortCallExposure([longCall('AAPL', 5)]);
    expect(result.bySymbol.AAPL).toBeUndefined();
  });

  it('filters out confirmed short puts', () => {
    const result = normalizeShortCallExposure([shortCall('AAPL', 1, 'P')]);
    expect(result.bySymbol.AAPL).toBeUndefined();
  });

  it('conservatively counts an unclassifiable short option as a call and flags it', () => {
    const unclassifiable: RawPositionLike = {
      'instrument-type': 'Equity Option',
      'underlying-symbol': 'AAPL',
      symbol: 'not-a-valid-occ-symbol',
      quantity: 1,
      'quantity-direction': 'Short',
    };
    const result = normalizeShortCallExposure([unclassifiable]);
    expect(result.bySymbol.AAPL).toBe(1);
    expect(result.unclassifiedSymbols.has('AAPL')).toBe(true);
  });

  it('fails the whole result closed when a short option cannot be attributed to any underlying', () => {
    const unattributable: RawPositionLike = {
      'instrument-type': 'Equity Option',
      symbol: undefined,
      quantity: 1,
      'quantity-direction': 'Short',
    };
    const result = normalizeShortCallExposure([unattributable, shortCall('AAPL', 1)]);
    expect(result.hasUnattributableExposure).toBe(true);
    // The unattributable position's quantity is never folded into any symbol's bySymbol.
    expect(Object.values(result.bySymbol).reduce((a, b) => a + b, 0)).toBe(1);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('ignores non-option instrument types', () => {
    const equity: RawPositionLike = {
      'instrument-type': 'Equity',
      'underlying-symbol': 'AAPL',
      quantity: 100,
      'quantity-direction': 'Short',
    };
    const result = normalizeShortCallExposure([equity]);
    expect(result.bySymbol.AAPL).toBeUndefined();
  });

  it('drops non-positive quantities', () => {
    const result = normalizeShortCallExposure([shortCall('AAPL', 0)]);
    expect(result.bySymbol.AAPL).toBeUndefined();
  });
});
