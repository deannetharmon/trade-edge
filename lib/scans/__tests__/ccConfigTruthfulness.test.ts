// lib/scans/__tests__/ccConfigTruthfulness.test.ts
//
// SCREENER-CONFIG-0001B (Alan) -- the covered-call scan-configuration registry states, for each
// control, what the engine does with it. This file proves each claim against the engine itself, so a
// label cannot promise behavior the engine does not perform. Covered calls differ from cash-secured
// puts (delta is a hard limit here) and from PMCC (OI is advisory here), and the registry says so.
//
// If the engine policy changes, the registry lifecycle, the receipt copy, and the matching test here
// must change together.

import { describe, it, expect } from 'vitest';
import { findBestCoveredCall, selectAllEligibleCcContracts } from '../covered-call-finder';
import { computeCoveredCallCapacity } from '../covered-call-capacity';
import type { CcRulesType } from '../constants';
import { CC_CRITERIA } from '@/lib/screener/scanConfig/ccRegistry';

const RULES: CcRulesType = { DELTA_MIN: 0.2, DELTA_MAX: 0.35, DTE_MIN: 21, DTE_MAX: 45, OI_MIN: 100, BID_ASK_MAX: 0.2 };

function isoDate(daysOut: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOut);
  return d.toISOString().slice(0, 10);
}

interface Call { strike: number; delta: number; bid: number; ask: number; oi: number }

function chainOf(byDte: Array<{ dte: number; calls: Call[] }>) {
  const expirations: string[] = [];
  const chains: Record<string, any[]> = {};
  for (const { dte, calls } of byDte) {
    const exp = isoDate(dte);
    expirations.push(exp);
    chains[exp] = calls.map((c, i) => ({
      strikePrice: c.strike, expirationDate: exp, optionType: 'C' as const, delta: c.delta, bid: c.bid, ask: c.ask,
      mid: (c.bid + c.ask) / 2, openInterest: c.oi, occSymbol: `T_${exp}_${c.strike}_${i}`,
    }));
  }
  return { expirations, chains };
}

const good = (strike: number, over: Partial<Call> = {}): Call => ({ strike, delta: 0.28, bid: 1.2, ask: 1.3, oi: 500, ...over });
const eligible = (chain: ReturnType<typeof chainOf>, over: Partial<Parameters<typeof selectAllEligibleCcContracts>[1]> = {}) =>
  selectAllEligibleCcContracts(chain, {
    deltaTarget: { min: RULES.DELTA_MIN, max: RULES.DELTA_MAX }, dteTarget: { min: RULES.DTE_MIN, max: RULES.DTE_MAX },
    minStrike: 100, oiMin: RULES.OI_MIN, bidAskMax: RULES.BID_ASK_MAX, ...over,
  });
const capacity = computeCoveredCallCapacity(500, 0, 0, 90);
const find = (chain: ReturnType<typeof chainOf>, over: Record<string, unknown> = {}) =>
  findBestCoveredCall(chain, { rules: RULES, capacity, stockPrice: 100, ...over } as any);

describe('registry lifecycles match the engine: the pinned map', () => {
  it('pins which criteria are search limits, advisory, read-only, and result filters', () => {
    const ids = (lifecycle: string) => CC_CRITERIA.filter((c) => c.lifecycle === lifecycle).map((c) => c.id).sort();
    expect(ids('fetch')).toEqual(['delta', 'dte', 'earnings', 'minStrike', 'quoteValidity', 'width']);
    expect(ids('advisory')).toEqual(['oi']);
    expect(ids('read-only')).toEqual(['capacity']);
    expect(ids('result-filter')).toEqual(['resultChips']);
    // Covered calls have no gate that leaves a near-miss, and no rank-only preference.
    expect(ids('gate')).toEqual([]);
    expect(ids('rank')).toEqual([]);
  });

  it('the fixed criteria are exactly the ones the trader cannot change', () => {
    expect(CC_CRITERIA.filter((c) => c.fixed).map((c) => c.id).sort()).toEqual(['capacity', 'earnings', 'minStrike', 'quoteValidity', 'resultChips']);
  });
});

describe('DTE is a search range', () => {
  it('an expiration outside the window is never considered', () => {
    const chain = chainOf([{ dte: 10, calls: [good(105)] }, { dte: 30, calls: [good(110)] }]);
    expect(eligible(chain).map((c) => c.strikePrice)).toEqual([110]);
  });
});

describe('delta is a hard limit for covered calls (unlike cash-secured puts)', () => {
  it('a call outside the delta range is never a candidate', () => {
    const chain = chainOf([{ dte: 30, calls: [good(105, { delta: 0.1 }), good(106, { delta: 0.28 }), good(107, { delta: 0.5 })] }]);
    expect(eligible(chain).map((c) => c.strikePrice)).toEqual([106]);
  });

  it('with every call outside the range there is no candidate at all', () => {
    const chain = chainOf([{ dte: 30, calls: [good(105, { delta: 0.1 })] }]);
    expect(find(chain)).toBeNull();
  });
});

describe('max bid/ask width is a real, absolute dollar setting', () => {
  it('excludes a call wider than the setting and keeps one at or inside it', () => {
    const chain = chainOf([{ dte: 30, calls: [good(105, { bid: 1.0, ask: 1.21 }), good(106, { bid: 1.0, ask: 1.2 })] }]);
    expect(eligible(chain).map((c) => c.strikePrice)).toEqual([106]);
  });

  it('changing the setting changes the outcome (it is honored, unlike the CSP width)', () => {
    const chain = chainOf([{ dte: 30, calls: [good(105, { bid: 1.0, ask: 1.4 })] }]);
    expect(eligible(chain, { bidAskMax: 0.2 })).toHaveLength(0);
    expect(eligible(chain, { bidAskMax: 0.5 })).toHaveLength(1);
  });
});

describe('minimum strike is fixed: at or above the stock price, and above cost basis when known', () => {
  it('never offers an in-the-money call, and an at-the-money strike is allowed', () => {
    const chain = chainOf([{ dte: 30, calls: [good(95), good(100)] }]);
    expect(find(chain)?.shortStrike).toBe(100);
  });

  it('never offers a call below a known cost basis, even when it is above the stock price', () => {
    const chain = chainOf([{ dte: 30, calls: [good(105), good(112)] }]);
    const highBasis = computeCoveredCallCapacity(500, 0, 0, 110);
    expect(find(chain, { capacity: highBasis })?.shortStrike).toBe(112);
  });

  it('with an unknown cost basis, only the stock price applies and the call is flagged', () => {
    const chain = chainOf([{ dte: 30, calls: [good(105)] }]);
    const unknownBasis = computeCoveredCallCapacity(500, 0, 0, null);
    const candidate = find(chain, { capacity: unknownBasis });
    expect(candidate?.shortStrike).toBe(105);
    expect(candidate?.ccAssignmentWarning).toMatch(/cost basis unavailable/i);
  });
});

describe('quote validity is fixed', () => {
  it('excludes one-sided, crossed, and non-finite quotes', () => {
    const chain = chainOf([{ dte: 30, calls: [
      good(105, { bid: 0, ask: 1.2 }), good(106, { bid: 1.3, ask: 1.2 }), good(107, { bid: Number.NaN, ask: 1.2 }), good(108),
    ] }]);
    expect(eligible(chain).map((c) => c.strikePrice)).toEqual([108]);
  });
});

describe('earnings excludes a call that expires on or after the earnings date', () => {
  const chain = () => chainOf([{ dte: 30, calls: [good(105)] }]);

  it('a call that expires before earnings qualifies', () => {
    expect(find(chain(), { earningsDate: isoDate(40) })?.shortStrike).toBe(105);
  });

  it('a call that expires after earnings, or on the earnings date, is excluded', () => {
    expect(find(chain(), { earningsDate: isoDate(10) })).toBeNull();
    expect(find(chain(), { earningsDate: isoDate(30) })).toBeNull();
  });

  it('earnings that already happened do not exclude', () => {
    expect(find(chain(), { earningsDate: isoDate(-5) })?.shortStrike).toBe(105);
  });

  it('excludes only the calls that span earnings, not the whole symbol', () => {
    const two = chainOf([{ dte: 25, calls: [good(105)] }, { dte: 40, calls: [good(110)] }]);
    expect(find(two, { earningsDate: isoDate(30) })?.shortStrike).toBe(105);
  });

  it('PINNED CURRENT BEHAVIOR: with no earnings date on file the check cannot apply, so the call qualifies', () => {
    expect(find(chain(), { earningsDate: null })?.shortStrike).toBe(105);
    expect(find(chain(), { earningsDate: undefined })?.shortStrike).toBe(105);
  });
});

describe('open interest is advisory for covered calls (unlike PMCC)', () => {
  it('low open interest is kept, with a warning, never excluded', () => {
    const chain = chainOf([{ dte: 30, calls: [good(105, { oi: 40 })] }]);
    expect(eligible(chain)).toHaveLength(1);
    const candidate = find(chain);
    expect(candidate?.shortStrike).toBe(105);
    expect(candidate?.ccLiquidityWarning).not.toBeNull();
  });

  it('even zero open interest does not remove the call from the search', () => {
    expect(eligible(chainOf([{ dte: 30, calls: [good(105, { oi: 0 })] }]))).toHaveLength(1);
  });
});

describe('share capacity limits the quantity and can rule out a symbol', () => {
  it('no available covered contracts means no candidate', () => {
    const none = computeCoveredCallCapacity(50, 0, 0, 90);
    expect(find(chainOf([{ dte: 30, calls: [good(105)] }]), { capacity: none })).toBeNull();
  });

  it('the quantity never exceeds the available covered contracts', () => {
    const three = computeCoveredCallCapacity(300, 0, 0, 90);
    expect(find(chainOf([{ dte: 30, calls: [good(105)] }]), { capacity: three })?.ccAvailableCoveredContracts).toBe(3);
  });
});
