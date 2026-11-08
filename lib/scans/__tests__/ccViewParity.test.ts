// lib/scans/__tests__/ccViewParity.test.ts
//
// CC-SIMPLIFY-0001 Phase 2 -- Ian's parity fixture. At today's defaults the results-screen view must pick the same
// covered call the old pre-scan rules picked; widening a chip re-picks from the pool exactly as a scan with those rules
// would; the safety gates are never relaxed by a chip.

import { describe, expect, it } from 'vitest';
import type { WheelChainLeg } from '@/lib/wheel/chainSearch';
import { computeCoveredCallCapacity } from '../covered-call-capacity';
import { findBestCoveredCallWithFallback } from '../covered-call-finder';
import { DEFAULT_CC_RULES, type CcRulesType } from '../constants';
import {
  CC_WIDTH_CHOICES, DEFAULT_CC_VIEW, buildCcPool, ccScanRules, ccViewFromPreset, ccViewRules, ccViewWith, countCcViewHidden, detectCcPreset, type CcView,
} from '../ccView';
import { ccPremiumPerShare } from '../ccPremium';

type Chain = { expirations: string[]; chains: Record<string, WheelChainLeg[]> };

function expIn(days: number): string {
  const d = new Date(); d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function leg(exp: string, strike: number, delta: number, bid: number, ask: number, oi = 500): WheelChainLeg {
  return { strikePrice: strike, expirationDate: exp, optionType: 'C', delta, openInterest: oi, bid, ask, mid: (bid + ask) / 2, occSymbol: `T${exp}C${strike}` };
}
function chain(byExp: Record<string, WheelChainLeg[]>): Chain {
  const expirations = Object.keys(byExp).sort();
  return { expirations, chains: byExp };
}

const BASE: CcRulesType = { ...DEFAULT_CC_RULES };
const capacity = (basis: number) => computeCoveredCallCapacity(500, 0, 0, basis);

const VIEWS: Array<[string, CcView]> = [
  ['default', DEFAULT_CC_VIEW],
  ['upside', ccViewFromPreset('upside')],
  ['income', ccViewFromPreset('income')],
  ['at the money', ccViewFromPreset('atm')],
  ['width 15%', ccViewWith(DEFAULT_CC_VIEW, { widthPctMax: 15 })],
  ['width 5%', ccViewWith(DEFAULT_CC_VIEW, { widthPctMax: 5 })],
  ['custom wide delta', ccViewWith(DEFAULT_CC_VIEW, { deltaMin: 0.05, deltaMax: 0.60 })],
];

function expectParity(name: string, c: Chain, price: number, basis: number, earningsDate: string | null = null) {
  const e30 = Object.keys(c.chains);
  void e30;
  const cap = capacity(basis);
  const pool = buildCcPool(c, { dteMin: BASE.DTE_MIN, dteMax: BASE.DTE_MAX, stockPrice: price, costBasis: basis });
  for (const [label, view] of VIEWS) {
    const rules = ccViewRules(BASE, view);
    const old = findBestCoveredCallWithFallback(c, { rules, capacity: cap, stockPrice: price, earningsDate, allowBelowBasis: false });
    const viaPool = findBestCoveredCallWithFallback(pool, { rules, capacity: cap, stockPrice: price, earningsDate, allowBelowBasis: false });
    expect(viaPool, `${name} / ${label}`).toEqual(old);
  }
  return { pool, cap };
}

describe('default view = today\'s pre-scan rules', () => {
  it('the default view maps to exactly DEFAULT_CC_RULES', () => {
    expect(ccViewRules(BASE, DEFAULT_CC_VIEW)).toEqual(BASE);
    expect(detectCcPreset(DEFAULT_CC_VIEW)).toBe('balanced');
    expect(CC_WIDTH_CHOICES).toContain(DEFAULT_CC_VIEW.widthPctMax);
  });
  it('the scan rules are wide open on delta and width only', () => {
    const wide = ccScanRules(BASE);
    expect(wide.DTE_MIN).toBe(BASE.DTE_MIN);
    expect(wide.DTE_MAX).toBe(BASE.DTE_MAX);
    expect(wide.OI_MIN).toBe(BASE.OI_MIN);
    expect(wide.DELTA_MIN).toBeLessThan(0.05);
    expect(wide.DELTA_MAX).toBeGreaterThan(0.9);
  });
});

describe('parity: pool + view picks the same call as the old rules', () => {
  const e = expIn(30);

  it('1. normal: several calls inside the window', () => {
    const c = chain({ [e]: [leg(e, 102, 0.42, 3.0, 3.1), leg(e, 105, 0.33, 2.0, 2.1), leg(e, 108, 0.28, 1.20, 1.30), leg(e, 111, 0.22, 0.70, 0.76), leg(e, 115, 0.12, 0.30, 0.34)] });
    const { pool, cap } = expectParity('normal', c, 100, 90);
    const pick = findBestCoveredCallWithFallback(pool, { rules: ccViewRules(BASE, DEFAULT_CC_VIEW), capacity: cap, stockPrice: 100 });
    expect(pick?.shortStrike).toBe(108);
    expect(pick?.ccOutsideRangeNote).toBeUndefined();
  });

  it('2. empty window: falls back to the closest call outside it, with the note', () => {
    const c = chain({ [e]: [leg(e, 110, 0.12, 0.40, 0.44), leg(e, 114, 0.08, 0.25, 0.28), leg(e, 120, 0.04, 0.10, 0.12)] });
    const { pool, cap } = expectParity('empty window', c, 100, 90);
    const pick = findBestCoveredCallWithFallback(pool, { rules: ccViewRules(BASE, DEFAULT_CC_VIEW), capacity: cap, stockPrice: 100 });
    expect(pick?.shortStrike).toBe(110);
    expect(pick?.ccOutsideRangeNote).toMatch(/outside your/);
  });

  it('3. width: a wide call is skipped at 10% and chosen at 15%', () => {
    const wideBest = leg(e, 108, 0.28, 1.00, 1.14); // 13% of mid: wide at 10, fine at 15
    const tight = leg(e, 111, 0.22, 1.00, 1.05);
    const c = chain({ [e]: [wideBest, tight] });
    const { pool, cap } = expectParity('width', c, 100, 90);
    const at = (view: CcView) => findBestCoveredCallWithFallback(pool, { rules: ccViewRules(BASE, view), capacity: cap, stockPrice: 100 });
    expect(at(DEFAULT_CC_VIEW)?.shortStrike).toBe(111);
    expect(at(ccViewWith(DEFAULT_CC_VIEW, { widthPctMax: 15 }))?.shortStrike).toBe(108);
  });

  it('4. strike floor: underwater stock, no chip can offer a call below the cost basis', () => {
    const c = chain({ [e]: [leg(e, 105, 0.30, 1.5, 1.6), leg(e, 118, 0.22, 0.5, 0.55), leg(e, 122, 0.18, 0.30, 0.33), leg(e, 130, 0.06, 0.10, 0.12)] });
    const { pool, cap } = expectParity('below floor', c, 100, 120);
    const strikes = Object.values(pool.chains).flat().map(l => l.strikePrice);
    expect(Math.min(...strikes)).toBeGreaterThanOrEqual(120);
    for (const [, view] of VIEWS) {
      const pick = findBestCoveredCallWithFallback(pool, { rules: ccViewRules(BASE, view), capacity: cap, stockPrice: 100 });
      if (pick) expect(pick.shortStrike).toBeGreaterThanOrEqual(120);
    }
  });

  it('5. earnings: parity with an earnings date inside the second expiration', () => {
    const e1 = expIn(24); const e2 = expIn(38);
    const c = chain({ [e1]: [leg(e1, 108, 0.28, 1.0, 1.05)], [e2]: [leg(e2, 108, 0.28, 1.4, 1.46)] });
    expectParity('earnings', c, 100, 90, expIn(30));
  });

  it('6. half-cent mid: premium is the mid rounded DOWN, in the pick and everywhere', () => {
    const c = chain({ [e]: [leg(e, 108, 0.28, 0.10, 0.15)] });
    const { pool, cap } = expectParity('half cent', c, 100, 90);
    const pick = findBestCoveredCallWithFallback(pool, { rules: ccViewRules(BASE, DEFAULT_CC_VIEW), capacity: cap, stockPrice: 100 });
    expect(pick?.ccPremiumPerShare).toBe(0.12);
    expect(pick?.credit).toBe(60); // 0.12 x 100 x 5 contracts (500 shares)
  });

  it('pool matches a wide scan: nothing the view could show is lost', () => {
    const c = chain({ [e]: [leg(e, 102, 0.42, 3.0, 3.1), leg(e, 108, 0.28, 1.20, 1.30), leg(e, 125, 0.02, 0.05, 0.10), leg(e, 99, 0.60, 6, 6.1), leg(e, 112, 0.2, 0, 0.5, 0)] });
    const pool = buildCcPool(c, { dteMin: 21, dteMax: 45, stockPrice: 100, costBasis: 90 });
    const strikes = pool.chains[e].map(l => l.strikePrice).sort((a, b) => a - b);
    expect(strikes).toEqual([102, 108, 125]); // 99 is below the floor; 112 has no market (zero OI, bad bid)
  });
});

describe('At the money preset', () => {
  it('is delta .45-.55 and picks the call nearest .50, never below the strike floor', () => {
    const e = expIn(30);
    const c = chain({ [e]: [leg(e, 100, 0.52, 3.9, 4.0), leg(e, 104, 0.38, 2.4, 2.5), leg(e, 108, 0.28, 1.2, 1.3)] });
    const pool = buildCcPool(c, { dteMin: 21, dteMax: 45, stockPrice: 100, costBasis: 90 });
    const view = ccViewFromPreset('atm');
    expect(view).toMatchObject({ preset: 'atm', deltaMin: 0.45, deltaMax: 0.55 });
    expect(detectCcPreset(view)).toBe('atm');
    expect(findBestCoveredCallWithFallback(pool, { rules: ccViewRules(BASE, view), capacity: capacity(90), stockPrice: 100 })?.shortStrike).toBe(100);
    // Underwater (basis 120): the floor removes the at-the-money call, so no chip can offer a loss-locking strike.
    const under = buildCcPool(c, { dteMin: 21, dteMax: 45, stockPrice: 100, costBasis: 120 });
    expect(Object.keys(under.chains)).toHaveLength(0);
  });
});

describe('ccPremiumPerShare', () => {
  it('rounds down to the cent without float drift', () => {
    expect(ccPremiumPerShare(0.125)).toBe(0.12);
    expect(ccPremiumPerShare(0.29)).toBe(0.29);
    expect(ccPremiumPerShare(1.2549)).toBe(1.25);
    expect(ccPremiumPerShare(0)).toBe(0);
    expect(ccPremiumPerShare(NaN)).toBe(0);
  });
});

describe('hidden count and presets', () => {
  const e = expIn(30);
  const c = chain({ [e]: [leg(e, 102, 0.42, 3.0, 3.1), leg(e, 108, 0.28, 1.20, 1.30), leg(e, 111, 0.22, 1.00, 1.30), leg(e, 125, 0.05, 0.10, 0.12)] });
  const pool = buildCcPool(c, { dteMin: 21, dteMax: 45, stockPrice: 100, costBasis: 90 });
  it('counts calls the delta range or width hides, never safety-gate rejections', () => {
    expect(countCcViewHidden(pool, DEFAULT_CC_VIEW, { dteMin: 21, dteMax: 45, stockPrice: 100, costBasis: 90 })).toBe(3); // .42 and .05 by delta; the wide .22 by width
    expect(countCcViewHidden(pool, ccViewWith(DEFAULT_CC_VIEW, { deltaMin: 0.01, deltaMax: 0.99, widthPctMax: 30 }), { dteMin: 21, dteMax: 45, stockPrice: 100, costBasis: 90 })).toBe(0);
  });
  it('preset label follows the numbers', () => {
    expect(ccViewWith(DEFAULT_CC_VIEW, { deltaMin: 0.3, deltaMax: 0.4 }).preset).toBe('income');
    expect(ccViewWith(DEFAULT_CC_VIEW, { deltaMin: 0.07, deltaMax: 0.4 }).preset).toBe('custom');
  });
});
