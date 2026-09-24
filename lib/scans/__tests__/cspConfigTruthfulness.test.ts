// lib/scans/__tests__/cspConfigTruthfulness.test.ts
//
// SCREENER-CONFIG-0001A (Alan) -- the CSP scan-configuration registry states, for
// each control, what the engine does with it. This file proves each claim against
// the engine itself, so a label cannot say "Gate" for something the engine keeps as
// a preference, and no rejection rule can hide as a preference.
//
// If the engine policy changes, the registry lifecycle, the receipt copy, and the
// matching test here must change together.

import { describe, it, expect } from 'vitest';
import { findAllCsp } from '../csp-finder';
import { searchCspCandidates } from '../cspSearch';
import { classifyCspLiquidity, isBestOpportunitiesEligible, isOverallCspQualified } from '../cspQualification';
import { evaluateCspIvr } from '../cspIvrPolicy';
import { DEFAULT_CSP_RULES } from '../constants';
import { CSP_CRITERIA } from '@/lib/screener/scanConfig/cspRegistry';

function isoDate(daysOut: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOut);
  return d.toISOString().slice(0, 10);
}

interface Put { strike: number; delta: number; bid: number; ask: number; oi: number }

function chainOf(byDte: Array<{ dte: number; puts: Put[] }>) {
  const expirations: string[] = [];
  const chains: Record<string, any[]> = {};
  for (const { dte, puts } of byDte) {
    const exp = isoDate(dte);
    expirations.push(exp);
    chains[exp] = puts.map((p, i) => ({
      strikePrice: p.strike, expirationDate: exp, optionType: 'P' as const, delta: p.delta,
      bid: p.bid, ask: p.ask, mid: (p.bid + p.ask) / 2, openInterest: p.oi, occSymbol: `T_${exp}_${p.strike}_${i}`,
    }));
  }
  return { expirations, chains };
}

const PRICE = 100;
const RICH_ACCOUNT = { accountSelected: true, optionBuyingPower: 1_000_000, cashBalance: 1_000_000 };
const tight = (strike: number, delta: number, oi = 900): Put => ({ strike, delta, bid: 0.95, ask: 1.0, oi });

const run = (chain: ReturnType<typeof chainOf>, extra: Partial<Parameters<typeof findAllCsp>[2]> = {}, rules = DEFAULT_CSP_RULES) =>
  findAllCsp(chain, PRICE, { rules, contracts: 1, underlyingSymbol: 'T', capital: RICH_ACCOUNT, ...extra });

describe('registry lifecycles match the engine: the pinned map', () => {
  it('pins which criteria are fetch, gate, rank, advisory, and result-filter', () => {
    const ids = (lifecycle: string) => CSP_CRITERIA.filter((c) => c.lifecycle === lifecycle).map((c) => c.id).sort();
    expect(ids('fetch')).toEqual(['dte']);
    expect(ids('gate')).toEqual(['capital', 'earnings', 'ivrCap', 'liquidity', 'otm', 'pop', 'roc']);
    expect(ids('rank')).toEqual(['delta', 'ivrFloor', 'rankSecondary']);
    expect(ids('advisory')).toEqual(['oi']);
    expect(ids('result-filter')).toEqual(['resultChips']);
  });

  it('the fixed criteria are exactly the engine policies the trader cannot change', () => {
    expect(CSP_CRITERIA.filter((c) => c.fixed).map((c) => c.id).sort()).toEqual(['earnings', 'liquidity', 'resultChips']);
  });
});

describe('DTE is the only fetch boundary', () => {
  it('an expiration outside the DTE window is never considered', () => {
    const chain = chainOf([{ dte: 10, puts: [tight(95, -0.2)] }, { dte: 35, puts: [tight(90, -0.2)] }]);
    const result = run(chain);
    expect(result.results.map((r) => r.candidate.shortStrike)).toEqual([90]);
  });

  it('with no expiration in the window, nothing is fetched', () => {
    const result = run(chainOf([{ dte: 10, puts: [tight(95, -0.2)] }]));
    expect(result.results).toEqual([]);
    expect(result.reason).toBe('NO_EXPIRATION_IN_DTE_WINDOW');
  });
});

describe('delta is a preference, not a fetch boundary', () => {
  const chain = () => chainOf([{ dte: 35, puts: [tight(95, -0.1), tight(90, -0.2)] }]);

  it('keeps a quote-valid put outside the preferred band and marks it', () => {
    const result = run(chain());
    expect(result.results.map((r) => r.candidate.shortStrike).sort()).toEqual([90, 95]);
    const outside = result.results.find((r) => r.candidate.shortStrike === 95)!;
    const inside = result.results.find((r) => r.candidate.shortStrike === 90)!;
    expect((outside.candidate as any).cspDeltaTargetPassing).toBe(false);
    expect((inside.candidate as any).cspDeltaTargetPassing).toBe(true);
    // Both still qualify on market rules; the band does not disqualify.
    expect(outside.marketQualification).toBe('QUALIFIED');
    expect(inside.marketQualification).toBe('QUALIFIED');
  });

  it('but a put outside the band cannot be a Best Opportunity', () => {
    const result = run(chain());
    const bestOpp = (strike: number) => {
      const r = result.results.find((x) => x.candidate.shortStrike === strike)!;
      return isBestOpportunitiesEligible(r.marketQualification, r.accountEligibility, 'NOT_APPLICABLE', (r.candidate as any).cspDeltaTargetPassing, true);
    };
    expect(bestOpp(90)).toBe(true);
    expect(bestOpp(95)).toBe(false);
  });

  it('search alone (no scoring) retains the outside-band put and orders by distance to the band center', () => {
    const search = searchCspCandidates(chain(), { deltaMin: 0.15, deltaMax: 0.25, dteMin: 30, dteMax: 45, oiMin: 500, bidAskMax: 0.1 }, 'T');
    expect(search.candidates).toHaveLength(2);
    expect(search.candidates[0].strikePrice).toBe(90);
  });
});

describe('bid/ask liquidity is a fixed policy gate', () => {
  it('classifies strong, borderline, and poor by width against the midpoint', () => {
    expect(classifyCspLiquidity(0.10, 1.0).liquidityClass).toBe('STRONG');
    expect(classifyCspLiquidity(0.14, 1.0).liquidityClass).toBe('BORDERLINE');
    expect(classifyCspLiquidity(0.16, 1.0).liquidityClass).toBe('POOR');
    // The strong limit is the larger of $0.10 or 10% of mid.
    expect(classifyCspLiquidity(0.45, 5.0).liquidityClass).toBe('STRONG');
  });

  it('borderline is kept with a warning and excluded from Best Opportunities; poor is disqualified', () => {
    const chain = chainOf([{ dte: 35, puts: [
      { strike: 90, delta: -0.2, bid: 0.95, ask: 1.05, oi: 900 },
      { strike: 91, delta: -0.2, bid: 0.93, ask: 1.07, oi: 900 },
      { strike: 92, delta: -0.2, bid: 0.9, ask: 1.1, oi: 900 },
    ] }]);
    const by = Object.fromEntries(run(chain).results.map((r) => [r.candidate.shortStrike, r.marketQualification]));
    expect(by[90]).toBe('QUALIFIED');
    expect(by[91]).toBe('QUALIFIED_WITH_LIQUIDITY_WARNING');
    expect(by[92]).toBe('DISQUALIFIED_POOR_LIQUIDITY');
    const borderline = run(chain).results.find((r) => r.candidate.shortStrike === 91)!;
    expect(isBestOpportunitiesEligible(borderline.marketQualification, borderline.accountEligibility, 'NOT_APPLICABLE', true, true)).toBe(false);
  });

  it('the configured BID_ASK_MAX changes no pass or fail', () => {
    const chain = chainOf([{ dte: 35, puts: [
      { strike: 90, delta: -0.2, bid: 0.95, ask: 1.05, oi: 900 },
      { strike: 91, delta: -0.2, bid: 0.93, ask: 1.07, oi: 900 },
      { strike: 92, delta: -0.2, bid: 0.9, ask: 1.1, oi: 900 },
    ] }]);
    const outcomes = (bidAskMax: number) =>
      run(chain, {}, { ...DEFAULT_CSP_RULES, BID_ASK_MAX: bidAskMax }).results.map((r) => `${r.candidate.shortStrike}:${r.marketQualification}`).sort();
    expect(outcomes(0.01)).toEqual(outcomes(0.10));
    expect(outcomes(5)).toEqual(outcomes(0.10));
  });
});

describe('open interest is advisory', () => {
  it('low open interest is kept, qualified, and warned about', () => {
    const result = run(chainOf([{ dte: 35, puts: [tight(90, -0.2, 78)] }]));
    const r = result.results[0];
    expect(r.marketQualification).toBe('QUALIFIED');
    expect(r.advisoryWarnings.some((w) => /below the preferred minimum of 500/.test(w))).toBe(true);
    expect(isBestOpportunitiesEligible(r.marketQualification, r.accountEligibility, 'NOT_APPLICABLE', true, true)).toBe(true);
  });

  it('literal zero open interest cannot be a Best Opportunity', () => {
    const r = run(chainOf([{ dte: 35, puts: [tight(90, -0.2, 0)] }])).results[0];
    expect(r.marketQualification).toBe('QUALIFIED');
    expect(isBestOpportunitiesEligible(r.marketQualification, r.accountEligibility, 'NOT_APPLICABLE', true, r.candidate.shortOI != null && r.candidate.shortOI > 0)).toBe(false);
  });
});

describe('IVR: cap is a gate, floor is guidance, unavailable IVR is not enforced', () => {
  it('above the cap disqualifies the symbol, in the finder and in the policy check', () => {
    const chain = chainOf([{ dte: 35, puts: [tight(90, -0.2)] }]);
    const check = evaluateCspIvr(75, 30, 70);
    expect(check).toMatchObject({ status: 'fail', marketDisqualified: true });
    const result = run(chain, { ivrMarketDisqualified: check.marketDisqualified });
    expect(result.results[0].marketQualification).toBe('DISQUALIFIED_IVR');
  });

  it('at the cap and inside the band passes', () => {
    expect(evaluateCspIvr(70, 30, 70)).toMatchObject({ status: 'pass', marketDisqualified: false });
    expect(evaluateCspIvr(45.44, 30, 70)).toMatchObject({ status: 'pass', value: '45.4%', reason: 'Within 30-70% CSP range' });
  });

  it('below the floor only warns and ranks lower; it never disqualifies', () => {
    const check = evaluateCspIvr(20, 30, 70);
    expect(check).toMatchObject({ status: 'warn', marketDisqualified: false });
    expect(check.reason).toBe('Below the preferred 30% premium environment — ranked lower');
  });

  it('PINNED CURRENT BEHAVIOR (see CSP-IVR-0001): an unavailable IVR warns and the symbol is NOT disqualified', () => {
    const check = evaluateCspIvr(null, 30, 70);
    expect(check).toEqual({ status: 'warn', value: 'N/A', reason: 'Not available', marketDisqualified: false });
    expect(evaluateCspIvr(undefined, 30, 70).marketDisqualified).toBe(false);
    const result = run(chainOf([{ dte: 35, puts: [tight(90, -0.2)] }]), { ivrMarketDisqualified: check.marketDisqualified });
    expect(result.results[0].marketQualification).toBe('QUALIFIED');
  });

  it('keeps the exact wording the page showed before the check was extracted', () => {
    expect(evaluateCspIvr(80, 30, 70).reason).toBe('Above 70% hard cap — undefined risk');
    expect(evaluateCspIvr(80, 30, 70).value).toBe('80.0%');
  });
});

describe('earnings inside the expiration is a gate', () => {
  it('disqualifies a candidate whose expiration spans the earnings date', () => {
    const result = run(chainOf([{ dte: 35, puts: [tight(90, -0.2)] }]), { earningsDate: isoDate(10) });
    expect(result.results[0].marketQualification).toBe('DISQUALIFIED_EARNINGS');
  });

  it('does not disqualify when the earnings date is after expiration', () => {
    const result = run(chainOf([{ dte: 35, puts: [tight(90, -0.2)] }]), { earningsDate: isoDate(60) });
    expect(result.results[0].marketQualification).toBe('QUALIFIED');
  });
});

describe('Targeted POP, OTM, and ROC are gates that leave a visible near-miss', () => {
  it('a market-qualified candidate that fails only the Targeted gate is not qualified overall', () => {
    expect(isOverallCspQualified('QUALIFIED', 'FAILED')).toBe(false);
    expect(isOverallCspQualified('QUALIFIED', 'PASSED')).toBe(true);
    // Rank mode has no Targeted gates.
    expect(isOverallCspQualified('QUALIFIED', 'NOT_APPLICABLE')).toBe(true);
  });
});
