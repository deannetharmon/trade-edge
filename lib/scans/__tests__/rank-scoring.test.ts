// lib/scans/__tests__/rank-scoring.test.ts
//
// PMCC-0009: unit coverage for calcOtmPct, the canonical OTM-distance
// calculation consolidated from four independently-duplicated copies
// scattered across app/screener/page.tsx (TradeModal's order-entry gate,
// the result card display, calcFilteredOtmPct, calcRankedOtmPct). None of
// the four covered PMCC before this ticket, and their strategy coverage
// had already drifted apart from each other -- this file exists so that
// drift can't happen again silently.

import { describe, expect, it } from 'vitest';
import { calcOtmPct } from '../rank-scoring';

describe('calcOtmPct', () => {
  it('BPS: OTM% is positive when price is above the short put strike (safely OTM)', () => {
    const pct = calcOtmPct('BPS', 110, { shortStrike: 100 });
    expect(pct).toBeCloseTo(((110 - 100) / 110) * 100, 5);
  });

  it('CSP: uses the same formula as BPS (both are short puts)', () => {
    const bpsResult = calcOtmPct('BPS', 110, { shortStrike: 100 });
    const cspResult = calcOtmPct('CSP', 110, { shortStrike: 100 });
    expect(cspResult).toBe(bpsResult);
  });

  it('BCS: OTM% is positive when price is below the short call strike (safely OTM)', () => {
    const pct = calcOtmPct('BCS', 90, { shortStrike: 100 });
    expect(pct).toBeCloseTo(((100 - 90) / 90) * 100, 5);
  });

  it('PMCC: uses the same formula as BCS -- PMCC\u2019s short leg is a short call, same direction', () => {
    const bcsResult = calcOtmPct('BCS', 150, { shortStrike: 160 });
    const pmccResult = calcOtmPct('PMCC', 150, { shortStrike: 160 });
    expect(pmccResult).toBe(bcsResult);
    expect(pmccResult).toBeCloseTo(((160 - 150) / 150) * 100, 5);
  });

  it('IC: returns the tighter (minimum) of the two sides\u2019 OTM distance', () => {
    // put side further OTM than call side -- call side should win (smaller value)
    const pct = calcOtmPct('IC', 100, { shortStrike: 80, shortCallStrike: 105 });
    const putOtm = ((100 - 80) / 100) * 100; // 20%
    const callOtm = ((105 - 100) / 100) * 100; // 5%
    expect(pct).toBeCloseTo(Math.min(putOtm, callOtm), 5);
    expect(pct).toBeCloseTo(callOtm, 5);
  });

  it('IC: returns null when shortCallStrike is missing -- an IC needs both sides to compute a meaningful minimum', () => {
    expect(calcOtmPct('IC', 100, { shortStrike: 80 })).toBeNull();
  });

  it('returns null for a price of null, undefined, zero, or negative -- never divides by an invalid price', () => {
    expect(calcOtmPct('BPS', null, { shortStrike: 100 })).toBeNull();
    expect(calcOtmPct('BPS', undefined, { shortStrike: 100 })).toBeNull();
    expect(calcOtmPct('BPS', 0, { shortStrike: 100 })).toBeNull();
    expect(calcOtmPct('BPS', -5, { shortStrike: 100 })).toBeNull();
  });

  it('returns null for an unrecognized strategy rather than guessing a direction', () => {
    expect(calcOtmPct('UNKNOWN', 100, { shortStrike: 90 })).toBeNull();
  });

  it('CSP no longer requires a breakeven field to be present -- this is a deliberate behavior fix, not just a refactor: the original calcFilteredOtmPct copy in page.tsx required c.breakeven != null, but breakeven is never actually populated anywhere in the codebase for any SpreadCandidate, so that branch was dead code and CSP candidates never got an OTM% in Filtered mode before this ticket', () => {
    // No breakeven field at all in the input -- must still compute correctly.
    const pct = calcOtmPct('CSP', 110, { shortStrike: 100 });
    expect(pct).not.toBeNull();
    expect(pct).toBeCloseTo(((110 - 100) / 110) * 100, 5);
  });
});
