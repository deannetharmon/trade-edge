// lib/scans/__tests__/cspScoreGolden.test.ts
//
// CSP-SCORE-REVIEW-0001B (Alan): golden fixtures for csp-score-v3. Inputs are the real TQQQ 11/13 puts from the
// 2026-10-16 Rank export (technical fit 9, IVR 45.8% inside the 30-70 band, strong liquidity, no earnings).
// "v2Total" is the score the same export carried under the previous weights.

import { describe, expect, it } from 'vitest';
import { calculateCspScore, CSP_SCORE_VERSION, CSP_SCORE_WEIGHTS } from '../cspScore';

interface Golden { name: string; pop: number; otmPct: number; periodRocPct: number; annualizedRocPct: number; openInterest: number; delta: number; v2Total: number; v3Total: number }

const GOLDEN: Golden[] = [
  { name: 'TQQQ 63P', pop: 79.5141747, otmPct: 13.366336633663364, periodRocPct: 2.6587301587301586, annualizedRocPct: 33.463327859879584, openInterest: 493, delta: 0.2049, v2Total: 71.3589, v3Total: 72.6253 },
  { name: 'TQQQ 66P', pop: 73.1083819, otmPct: 9.240924092409239, periodRocPct: 3.318181818181818, annualizedRocPct: 41.76332288401254, openInterest: 920, delta: 0.2689, v2Total: 72.4467, v3Total: 70.9178 },
  { name: 'TQQQ 67P', pop: 70.6970173, otmPct: 7.865786578657865, periodRocPct: 3.67910447761194, annualizedRocPct: 46.305970149253724, openInterest: 558, delta: 0.2930, v2Total: 73.5595, v3Total: 70.7942 },
  { name: 'TQQQ 70P', pop: 62.4097435, otmPct: 3.740374037403739, periodRocPct: 4.714285714285714, annualizedRocPct: 59.33497536945813, openInterest: 1498, delta: 0.3759, v2Total: 73.8897, v3Total: 68.2310 },
];

function score(g: Golden) {
  return calculateCspScore({
    pop: g.pop, otmPct: g.otmPct, periodRocPct: g.periodRocPct, annualizedRocPct: g.annualizedRocPct,
    liquidityClass: 'STRONG', openInterest: g.openInterest, oiMin: 500, technicalFit: 9,
    ivr: 45.8, ivrMin: 30, ivrMax: 70, earningsWithinExpiration: false,
  });
}

describe('csp-score-v3 weights', () => {
  it('is version v3 and still sums to 100', () => {
    expect(CSP_SCORE_VERSION).toBe('csp-score-v3');
    const sum = Object.values(CSP_SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it('puts 30 points on cushion and 15 on premium efficiency', () => {
    expect(CSP_SCORE_WEIGHTS.pop + CSP_SCORE_WEIGHTS.otm).toBe(30);
    expect(CSP_SCORE_WEIGHTS.periodRoc + CSP_SCORE_WEIGHTS.annualizedRoc).toBe(15);
  });
});

describe('csp-score-v3 golden fixtures (TQQQ 11/13)', () => {
  for (const g of GOLDEN) {
    it(`${g.name} scores ${g.v3Total.toFixed(2)}`, () => {
      const r = score(g);
      expect(r.scoreStatus).toBe('AVAILABLE');
      expect(r.scoreVersion).toBe('csp-score-v3');
      expect(r.total as number).toBeCloseTo(g.v3Total, 3);
    });
  }

  it('a delta .38 put no longer ties a delta .29 put', () => {
    const p70 = score(GOLDEN[3]).total as number;
    const p67 = score(GOLDEN[2]).total as number;
    expect(p67 - p70).toBeGreaterThan(2);
  });

  it('orders the four strikes 63P > 66P > 67P > 70P, closer to the delta ordering traders expect', () => {
    const totals = GOLDEN.map(g => score(g).total as number);
    expect(totals[0]).toBeGreaterThan(totals[1]);
    expect(totals[1]).toBeGreaterThan(totals[2]);
    expect(totals[2]).toBeGreaterThan(totals[3]);
  });

  it('the change from v2 is cushion up, return down: low-delta puts gain, high-delta puts lose', () => {
    const shifts = GOLDEN.map(g => (score(g).total as number) - g.v2Total);
    expect(shifts[0]).toBeGreaterThan(0); // 63P, delta .20
    expect(shifts[3]).toBeLessThan(-5);   // 70P, delta .38
    for (let i = 1; i < shifts.length; i++) expect(shifts[i]).toBeLessThan(shifts[i - 1]);
  });
});
