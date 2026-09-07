import { describe, expect, it } from 'vitest';
import { calculateCspReturnThisCycle, sortCspByThirtyDayEquivalent } from '../cspReturnThisCycle';

describe('calculateCspReturnThisCycle', () => {
  it('uses the executable bid and cash-secured strike, without mutating legacy values', () => {
    const candidate = { shortBid: 1.5, shortStrike: 100, dte: 30, roc: 9, annualizedRoc: 99 };
    expect(calculateCspReturnThisCycle(candidate)).toMatchObject({ securedCash: 10000, bidPremiumPerContract: 150, cycleReturnPct: 1.5, thirtyDayEquivalentPct: 1.5, bidBasedAnnualizedReturnPct: 18.25, status: 'TARGET_RANGE' });
    expect(candidate).toEqual({ shortBid: 1.5, shortStrike: 100, dte: 30, roc: 9, annualizedRoc: 99 });
  });
  it('uses 100 only when multiplier is absent, and accepts zero bid and DTE 1', () => {
    expect(calculateCspReturnThisCycle({ shortBid: 0, shortStrike: 50, dte: 1 })).toMatchObject({ available: true, cycleReturnPct: 0, status: 'LOW' });
    expect(calculateCspReturnThisCycle({ shortBid: 1, shortStrike: 50, dte: 1, contractMultiplier: 10 })).toMatchObject({ securedCash: 500, bidPremiumPerContract: 10, thirtyDayEquivalentPct: 60 });
  });
  it('fails closed for invalid data and uses unrounded band boundaries', () => {
    expect(calculateCspReturnThisCycle({ shortBid: null, shortStrike: 50, dte: 30 }).available).toBe(false);
    expect(calculateCspReturnThisCycle({ shortBid: 1, shortStrike: 50, dte: 30, contractMultiplier: 0 }).available).toBe(false);
    expect(calculateCspReturnThisCycle({ shortBid: 0.75, shortStrike: 100, dte: 30 }).status).toBe('MODERATE');
    expect(calculateCspReturnThisCycle({ shortBid: 1.75, shortStrike: 100, dte: 30 }).status).toBe('TARGET_RANGE');
    expect(calculateCspReturnThisCycle({ shortBid: 1.751, shortStrike: 100, dte: 30 }).status).toBe('HIGH_RATE_REVIEW');
  });
  it('sorts targeted CSP values, descending then ascending, with unavailable last', () => {
    const rows = [{ id: 'low', shortBid: 1, shortStrike: 100, dte: 30 }, { id: 'high', shortBid: 2, shortStrike: 100, dte: 30 }, { id: 'none', shortBid: null, shortStrike: 100, dte: 30 }];
    expect(sortCspByThirtyDayEquivalent(rows, 'desc').map(x => x.id)).toEqual(['high', 'low', 'none']);
    expect(sortCspByThirtyDayEquivalent(rows, 'asc').map(x => x.id)).toEqual(['low', 'high', 'none']);
  });
});
