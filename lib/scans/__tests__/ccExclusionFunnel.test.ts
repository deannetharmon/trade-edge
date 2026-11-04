// lib/scans/__tests__/ccExclusionFunnel.test.ts
// CC-WHEEL-0001 -- the "why did nothing qualify" report counts exactly what the real gate removes.
import { describe, it, expect } from 'vitest';
import { diagnoseCcExclusions, formatCcExclusionSummary, findBestCoveredCall } from '../covered-call-finder';
import { computeCoveredCallCapacity } from '../covered-call-capacity';
import type { CcRulesType } from '../constants';
import type { WheelChainLeg } from '@/lib/wheel/chainSearch';

const RULES: CcRulesType = { DELTA_MIN: 0.10, DELTA_MAX: 0.60, DTE_MIN: 14, DTE_MAX: 60, OI_MIN: 100, WIDTH_PCT_MAX: 10, WIDTH_CEILING: 0.50 };

function expIn(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function leg(exp: string, strike: number, delta: number, bid: number, ask: number, type: 'C' | 'P' = 'C'): WheelChainLeg {
  return { strikePrice: strike, expirationDate: exp, optionType: type, delta: type === 'P' ? -delta : delta, openInterest: 500, bid, ask, mid: (bid + ask) / 2, occSymbol: `T${type}${strike}` } as unknown as WheelChainLeg;
}

const NEAR = expIn(30);
const FAR = expIn(120); // outside DTE 14-60
const chain = {
  expirations: [NEAR, FAR],
  chains: {
    [NEAR]: [
      leg(NEAR, 64, 0.45, 2.0, 2.1),   // below floor
      leg(NEAR, 80, 0.12, 0.5, 0.55),  // below floor (82)
      leg(NEAR, 85, 0.08, 0.2, 0.25),  // delta outside 0.10-0.60
      leg(NEAR, 90, 0.12, 0.5, 0.55),  // eligible
      leg(NEAR, 95, 0.15, 0, 0.3),     // no usable quote
      leg(NEAR, 100, 0.20, 0.1, 0.9),  // too wide
      leg(NEAR, 70, 0.3, 1, 1.1, 'P'), // a put: never counted
    ],
    [FAR]: [leg(FAR, 90, 0.2, 1, 1.05)],
  },
};

const capacity = computeCoveredCallCapacity(100, 0, 0, 82);
const params = { rules: RULES, capacity, stockPrice: 62.85 };

describe('diagnoseCcExclusions', () => {
  const r = diagnoseCcExclusions(chain, params);
  it('counts calls, ignores puts, separates DTE from the other rules', () => {
    expect(r.callsTotal).toBe(7);
    expect(r.outsideDte).toBe(1);
    expect(r.inWindow).toBe(6);
  });
  it('counts the first rule that removed each leg', () => {
    expect(r.floor).toBe(82);
    expect(r.rejected.BELOW_FLOOR).toBe(2);
    expect(r.rejected.DELTA_WINDOW).toBe(1);
    expect(r.rejected.BAD_QUOTE).toBe(1);
    expect(r.rejected.WIDTH).toBe(1);
    expect(r.eligible).toBe(1);
  });
  it('agrees with the real finder: eligible > 0 exactly when a candidate exists', () => {
    expect(findBestCoveredCall(chain, params)?.shortStrike).toBe(90);
    const none = { ...chain, chains: { ...chain.chains, [NEAR]: chain.chains[NEAR].filter((l) => l.strikePrice !== 90) } };
    expect(diagnoseCcExclusions(none, params).eligible).toBe(0);
    expect(findBestCoveredCall(none, params)).toBeNull();
  });
  it('reports the highest delta at or above the floor, ignoring the delta window', () => {
    expect(r.bestDeltaAtFloor).toEqual({ delta: 0.2, strike: 100, expiration: NEAR });
  });
  it('a widened delta and DTE window cannot rescue a strike below the floor', () => {
    const wide = diagnoseCcExclusions(chain, { ...params, rules: { ...RULES, DELTA_MIN: 0, DELTA_MAX: 1, DTE_MIN: 0, DTE_MAX: 365 } });
    expect(wide.rejected.BELOW_FLOOR).toBe(2);
  });
  it('earnings: an expiry too close to earnings is counted separately', () => {
    const e = diagnoseCcExclusions(chain, { ...params, earningsDate: expIn(33) });
    expect(e.eligible).toBe(0);
    expect(e.removedByEarnings).toBe(1);
  });
});

describe('formatCcExclusionSummary', () => {
  it('names each rule and the best delta at the floor in one line', () => {
    const text = formatCcExclusionSummary(diagnoseCcExclusions(chain, params), RULES);
    expect(text).toContain('7 calls: 1 outside DTE 14-60');
    expect(text).toContain('strike below $82.00 floor 2');
    expect(text).toContain('delta outside 0.1-0.6 1');
    expect(text).toContain('no usable quote 1');
    expect(text).toContain('bid/ask too wide 1');
    expect(text).toContain('Highest delta at or above the floor: 0.20 (strike $100');
  });
  it('handles an empty chain', () => {
    expect(formatCcExclusionSummary(diagnoseCcExclusions({ expirations: [], chains: {} }, params), RULES)).toBe('The chain returned no calls.');
  });
});
