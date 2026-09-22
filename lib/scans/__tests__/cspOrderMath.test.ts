// lib/scans/__tests__/cspOrderMath.test.ts

import { describe, expect, it } from 'vitest';
import { buildCspOrderLeg, computeCspMaxLoss, computeCspOtmPct } from '../cspOrderMath';

describe('computeCspMaxLoss', () => {
  it('is (strike * 100 - credit) * quantity, NOT a spread-width formula (Ian, 2026-09-22)', () => {
    // 235 strike, $802.50 credit, 1 contract, matching Dean's own MRVL screenshot.
    expect(computeCspMaxLoss(235, 802.50, 1)).toBeCloseTo(235 * 100 - 802.50, 2);
    expect(computeCspMaxLoss(235, 802.50, 1)).toBeCloseTo(22697.50, 2);
  });

  it('scales linearly with quantity', () => {
    expect(computeCspMaxLoss(100, 50, 3)).toBe((100 * 100 - 50) * 3);
  });

  it('a credit of exactly zero is the full strike value (never negative, never NaN)', () => {
    expect(computeCspMaxLoss(50, 0, 1)).toBe(5000);
  });

  it.each([
    ['a zero strike', 0, 10, 1], ['a negative strike', -5, 10, 1],
    ['a negative credit', 50, -1, 1], ['a zero quantity', 50, 10, 0], ['a fractional quantity', 50, 10, 1.5],
  ])('rejects %s', (_n, strike, credit, qty) => {
    expect(() => computeCspMaxLoss(strike, credit, qty)).toThrow();
  });
});

describe('computeCspOtmPct', () => {
  it('matches a BPS short leg\'s formula: (price - strike) / price * 100', () => {
    expect(computeCspOtmPct(338.67, 300)).toBeCloseTo(((338.67 - 300) / 338.67) * 100, 5);
  });

  it('a strike above price (deep ITM) is negative, correctly flagging risk rather than hiding it', () => {
    expect(computeCspOtmPct(338.67, 400)).toBeLessThan(0);
  });

  it('returns null, never throws, when the underlying price is unavailable', () => {
    for (const price of [null, undefined, NaN, 0, -5]) expect(computeCspOtmPct(price as number, 100)).toBeNull();
  });
});

describe('buildCspOrderLeg', () => {
  it('builds exactly one Sell to Open leg -- never more, unlike a spread', () => {
    const result = buildCspOrderLeg('AAPL  271015P00235000', 2, false);
    expect(result).toEqual({ ok: true, leg: { 'instrument-type': 'Equity Option', symbol: 'AAPL  271015P00235000', quantity: 2, action: 'Sell to Open' } });
  });

  it('uses Index Option for an index underlying', () => {
    const result = buildCspOrderLeg('SPX   271015P08200000', 1, true);
    expect(result.ok && result.leg['instrument-type']).toBe('Index Option');
  });

  it('refuses a missing OCC symbol rather than building a malformed order', () => {
    expect(buildCspOrderLeg(null, 1, false)).toEqual({ ok: false, reason: expect.stringContaining('OCC symbol') });
    expect(buildCspOrderLeg(undefined, 1, false).ok).toBe(false);
    expect(buildCspOrderLeg('', 1, false).ok).toBe(false);
  });

  it.each([[0], [-1], [1.5]])('refuses an invalid quantity (%s)', (qty) => {
    expect(buildCspOrderLeg('X', qty, false).ok).toBe(false);
  });
});
