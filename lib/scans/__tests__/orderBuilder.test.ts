// lib/scans/__tests__/orderBuilder.test.ts
//
// PMCC-0007: unit coverage for buildOrderLegs, buildOrderPayload, and
// hasOccSymbolsForOrder -- extracted from app/screener/page.tsx (see
// orderBuilder.ts's module doc for why: the same page.tsx-export
// constraint that broke an earlier Vercel build, plus these being pure
// enough to not need to live in the giant screener page file at all).
// Covers the existing BPS/BCS/IC branches (unchanged, verbatim) and the
// new PMCC branches this ticket adds.

import { describe, expect, it } from 'vitest';
import { buildOrderLegs, buildOrderPayload, hasOccSymbolsForOrder } from '../orderBuilder';
import type { ScreenResult, SpreadCandidate } from '../types';

function bpsCandidate(overrides: Partial<SpreadCandidate> = {}): SpreadCandidate {
  return {
    strategy: 'BPS', expiration: '2026-09-18', dte: 30,
    shortStrike: 95, longStrike: 90, shortDelta: -0.25,
    credit: 1.5, spreadWidth: 5, creditRatio: 0.3, roc: 30, pop: 70,
    shortOI: 500, longOI: 500,
    shortOccSymbol: 'MU   260918P00095000', longOccSymbol: 'MU   260918P00090000',
    ...overrides,
  } as SpreadCandidate;
}

function pmccCandidate(overrides: Partial<SpreadCandidate> = {}): SpreadCandidate {
  return {
    strategy: 'PMCC', expiration: '2026-09-25', dte: 43,
    shortStrike: 160, longStrike: 100, shortDelta: -0.28,
    credit: 3, spreadWidth: 0, creditRatio: 0, roc: 15, pop: null,
    shortOI: 500, longOI: 200,
    longExpiration: '2027-09-17', longDte: 401, longDelta: 0.80,
    longCost: 50, netDebit: 47,
    longOccSymbolPMCC: 'NVDA  270917C00100000', shortOccSymbolPMCC: 'NVDA  260925C00160000',
    ...overrides,
  } as SpreadCandidate;
}

function stockResult(overrides: Partial<ScreenResult> = {}): ScreenResult {
  return {
    symbol: 'MU', strategy: 'BPS', price: 920, ivr: 50, qualified: true,
    bestCandidate: bpsCandidate(), failReasons: [], checks: {} as any,
    underlyingType: 'stock',
    ...overrides,
  } as ScreenResult;
}

describe('hasOccSymbolsForOrder', () => {
  it('is true for a BPS candidate with both OCC symbols present', () => {
    expect(hasOccSymbolsForOrder(bpsCandidate())).toBe(true);
  });

  it('is false for a BPS candidate missing a leg symbol', () => {
    expect(hasOccSymbolsForOrder(bpsCandidate({ longOccSymbol: undefined }))).toBe(false);
  });

  it('is true for a PMCC candidate with both PMCC-specific OCC symbols present', () => {
    expect(hasOccSymbolsForOrder(pmccCandidate())).toBe(true);
  });

  it('is false for a PMCC candidate missing either PMCC-specific symbol -- and does NOT fall back to checking the generic shortOccSymbol/longOccSymbol fields', () => {
    expect(hasOccSymbolsForOrder(pmccCandidate({ shortOccSymbolPMCC: undefined }))).toBe(false);
    // Confirms the pre-PMCC-0007 bug this fixes: a PMCC candidate with the
    // GENERIC fields set (which findBestPMCC never populates) but its own
    // PMCC-specific fields missing must still read as false, not true.
    const withGenericOnly = pmccCandidate({
      longOccSymbolPMCC: undefined, shortOccSymbolPMCC: undefined,
      shortOccSymbol: 'NVDA  260925C00160000', longOccSymbol: 'NVDA  270917C00100000',
    });
    expect(hasOccSymbolsForOrder(withGenericOnly)).toBe(false);
  });
});

describe('buildOrderLegs', () => {
  it('builds two legs for BPS: short put sell-to-open, long put buy-to-open', () => {
    const legs = buildOrderLegs(stockResult(), bpsCandidate());
    expect(legs).toHaveLength(2);
    expect(legs[0]).toMatchObject({ symbol: 'MU   260918P00095000', action: 'Sell to Open' });
    expect(legs[1]).toMatchObject({ symbol: 'MU   260918P00090000', action: 'Buy to Open' });
  });

  it('builds two legs for PMCC: LEAP buy-to-open first, short call sell-to-open second', () => {
    const legs = buildOrderLegs(stockResult({ strategy: 'PMCC' }), pmccCandidate());
    expect(legs).toHaveLength(2);
    expect(legs[0]).toMatchObject({ symbol: 'NVDA  270917C00100000', action: 'Buy to Open' });
    expect(legs[1]).toMatchObject({ symbol: 'NVDA  260925C00160000', action: 'Sell to Open' });
  });

  it('PMCC legs use each leg\u2019s own OCC symbol to carry its own expiration -- no shared-expiration field needed anywhere in the payload', () => {
    // The two OCC symbols themselves encode different expirations
    // (270917 vs 260925) -- this is the whole mechanism that makes a
    // multi-expiration order representable without any special payload
    // shape beyond what BPS/BCS/IC already use.
    const legs = buildOrderLegs(stockResult({ strategy: 'PMCC' }), pmccCandidate());
    expect(legs[0].symbol).toContain('270917');
    expect(legs[1].symbol).toContain('260925');
  });

  it('returns an empty array for an unrecognized strategy rather than throwing', () => {
    const legs = buildOrderLegs(stockResult({ strategy: 'UNKNOWN' as any }), bpsCandidate({ strategy: 'UNKNOWN' as any }));
    expect(legs).toEqual([]);
  });
});

describe('buildOrderPayload', () => {
  it('builds a Credit-effect payload for BPS at the given quantity', () => {
    const legs = buildOrderLegs(stockResult(), bpsCandidate());
    const payload = buildOrderPayload(bpsCandidate(), 2, legs);
    expect(payload['price-effect']).toBe('Credit');
    expect(payload.price).toBe('3.00'); // 1.5 credit * 2 qty
    expect(payload.legs.every((l: any) => l.quantity === 2)).toBe(true);
  });

  it('builds a Debit-effect payload for PMCC, priced off netDebit -- never off credit-per-contract math', () => {
    const legs = buildOrderLegs(stockResult({ strategy: 'PMCC' }), pmccCandidate());
    const payload = buildOrderPayload(pmccCandidate(), 1, legs);
    expect(payload['price-effect']).toBe('Debit');
    expect(payload.price).toBe('47.00'); // netDebit, qty 1
  });

  it('scales the PMCC debit price by quantity', () => {
    const legs = buildOrderLegs(stockResult({ strategy: 'PMCC' }), pmccCandidate());
    const payload = buildOrderPayload(pmccCandidate(), 3, legs);
    expect(payload.price).toBe('141.00'); // 47 * 3
  });

  it('treats a missing netDebit as 0 rather than throwing or producing NaN', () => {
    const legs = buildOrderLegs(stockResult({ strategy: 'PMCC' }), pmccCandidate({ netDebit: undefined }));
    const payload = buildOrderPayload(pmccCandidate({ netDebit: undefined }), 1, legs);
    expect(payload.price).toBe('0.00');
  });
});
