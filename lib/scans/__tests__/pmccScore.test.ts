// lib/scans/__tests__/pmccScore.test.ts
//
// SCAN-ALIGN-0001C1 (Alan) -- an OI-exempt held long (null OI) borrows the short's OI for its
// OI half only; its own spread still counts. Liquidity = round(min(longFrac, shortFrac) * 30),
// leg fraction = 0.5 * spreadFrac (1 - spread/10) + 0.5 * oiFrac (oi/500, capped at 1).

import { describe, expect, it } from 'vitest';
import { computePmccScore, type PmccScoreInputs } from '../pmccScore';

const base: PmccScoreInputs = {
  annualizedRoiPct: 20,
  longLegSpreadPct: 2,
  longLegOpenInterest: null,
  shortLegSpreadPct: 1,
  shortLegOpenInterest: 300,
  earningsDate: null,
  shortLegExpiration: '2026-09-18',
  earningsDeductionEnabled: false,
};

const liquidity = (overrides: Partial<PmccScoreInputs>) => computePmccScore({ ...base, ...overrides }).liquidityScore;

describe('computePmccScore liquidity with an OI-exempt held long', () => {
  it('(a) long spread 2%, short spread 1%, short OI 300, long OI null: long 0.70, short 0.75, min 0.70 -> 21', () => {
    expect(liquidity({})).toBe(21);
  });

  it('(b) same long with real OI 500 -> 23; null never outranks a valid long at the same spread and OI >= short OI', () => {
    const valid = liquidity({ longLegOpenInterest: 500 });
    expect(valid).toBe(23);
    expect(liquidity({})).toBeLessThanOrEqual(valid);
  });

  it('(c) both OI null: OI halves are 0, liquidity stays capped at 15', () => {
    expect(liquidity({ longLegSpreadPct: 0, shortLegSpreadPct: 0, shortLegOpenInterest: null })).toBe(15);
  });

  it('(d) long spread 10% (fraction 0), OI null: long = 0.5*0 + 0.5*0.6, not lifted to the short fraction -> 9', () => {
    expect(liquidity({ longLegSpreadPct: 10 })).toBe(9);
  });

  it('(e) non-null long OI is unchanged (no borrowing)', () => {
    // long 0.5*0.8 + 0.5*0.2 = 0.5 (OI 100 -> 0.2); short 0.75 -> min 0.5 -> 15
    expect(liquidity({ longLegOpenInterest: 100 })).toBe(15);
    // a real long OI below the short's is not replaced by the short's
    expect(liquidity({ longLegOpenInterest: 100 })).toBeLessThan(liquidity({ longLegOpenInterest: null }));
  });
});
