// lib/scans/__tests__/scanAlignC2HybridSpread.test.ts
//
// SCAN-ALIGN-0001C2 -- Alan's golden fixtures for the hybrid bid/ask policy, run through the ONE
// shared function, isEligibleCcLeg (via selectAllEligibleCcContracts) and evaluatePmccQuoteQuality.

import { describe, it, expect } from 'vitest';
import { evaluateHybridSpread, validateCc } from '../hybridSpread';
import { selectAllEligibleCcContracts } from '../covered-call-finder';
import { evaluatePmccQuoteQuality } from '../pmccQuoteQuality';
import { DEFAULT_PMCC_QUOTE_POLICY, isValidPmccQuotePolicy } from '../pmccConfig';
import { DEFAULT_CC_RULES, DEFAULT_CSP_RULES, DEFAULT_RULES, DEFAULT_ETF_RULES } from '../constants';
import { cspFieldErrors } from '@/lib/screener/scanConfig/cspValidation';
import type { PmccChainLeg } from '../pmccTypes';

type Outcome = 'ok' | 'warn' | 'reject';
type Role = 'short' | 'long';

// [bid, ask, role, expected]. Ceiling 0.50 applies to role 'short' only.
const TABLE: Array<[number, number, Role, Outcome]> = [
  [0.28, 0.33, 'short', 'ok'],        // float trap 0.05000000000000004
  [5.75, 6.25, 'short', 'warn'],      // 8.33%; ceiling 0.50 > 0.50 is false
  [0.95, 1.05, 'short', 'warn'],      // exactly 10%: passes reject, warns
  [0.95, 1.0501, 'short', 'reject'],
  [0.30, 0.30, 'short', 'ok'],        // locked passes, no warn
  [0.31, 0.30, 'short', 'reject'],    // crossed
  [0.00, 0.10, 'short', 'reject'],
  [0.10, 0.00, 'short', 'reject'],
  [0.00, 0.00, 'short', 'reject'],
  [1.94, 2.06, 'short', 'warn'],      // mid 2.00, w 0.12: passes reject (limit 0.20), warns (limit 0.10)
  [0.075, 0.125, 'short', 'ok'],      // mid 0.10, w 0.05: no warn (the $0.05 floor is one floor)
  [0.06, 0.14, 'short', 'reject'],    // w 0.08 on mid 0.10
  [19.00, 21.00, 'short', 'reject'],  // percent passes; the ceiling rejects
  [99.00, 101.00, 'long', 'ok'],      // new PMCC LEAP: ceiling not applied, 2% no warn
  [96.00, 104.00, 'long', 'warn'],    // 8% LEAP: warns, proves ceiling scope
  [9.75, 10.25, 'short', 'ok'],       // w 0.50: ceiling 0.50 > 0.50 is false; exactly 5% no warn
  [9.74, 10.26, 'short', 'reject'],   // w 0.52: ceiling
  // old-rule flips (the retired $0.20 cap passed these)
  [1.00, 1.20, 'short', 'reject'],
  [1.00, 1.21, 'short', 'reject'],
  [1.00, 1.40, 'short', 'reject'],
  [0.10, 0.30, 'short', 'reject'],
];

const POLICY = { rejectPct: 10, warnPct: 5 };
const ceilingFor = (role: Role) => (role === 'short' ? 0.5 : null);

const asOf = new Date('2026-08-14T20:00:00.000Z');
const pmccLeg = (bid: number, ask: number): PmccChainLeg => ({
  underlyingSymbol: 'GS', optionType: 'C', expiration: '2026-09-18', strike: 1070, delta: 0.23, openInterest: 860,
  bid, ask, occSymbol: 'GS260918C01070000', quoteTimestamp: '2026-08-14T19:59:30.000Z', delayed: false,
});

function isoDate(daysOut: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOut);
  return d.toISOString().slice(0, 10);
}
function ccEligible(bid: number, ask: number): boolean {
  const exp = isoDate(30);
  const chain = {
    expirations: [exp],
    chains: { [exp]: [{ strikePrice: 105, expirationDate: exp, optionType: 'C' as const, delta: 0.28, bid, ask, mid: (bid + ask) / 2, openInterest: 500, occSymbol: 'T_CC' }] },
  };
  return selectAllEligibleCcContracts(chain as never, {
    deltaTarget: { min: 0.2, max: 0.35 }, dteTarget: { min: 21, max: 45 }, minStrike: null, oiMin: 100,
    widthPctMax: DEFAULT_CC_RULES.WIDTH_PCT_MAX, widthCeiling: DEFAULT_CC_RULES.WIDTH_CEILING,
  }).length === 1;
}

describe("Alan's C2 table through the shared function", () => {
  it.each(TABLE)('%s / %s (%s) -> %s', (bid, ask, role, expected) => {
    const r = evaluateHybridSpread(bid, ask, { ...POLICY, ceiling: ceilingFor(role) });
    expect(r.reject).toBe(expected === 'reject');
    expect(r.warn).toBe(expected === 'warn');
  });

  it('the ceiling status is distinguishable from the percent rule', () => {
    expect(evaluateHybridSpread(19, 21, { ...POLICY, ceiling: 0.5 }).status).toBe('over_ceiling');
    expect(evaluateHybridSpread(19, 21, POLICY).status).toBe('wide_warning'); // 10% of mid: percent passes, warns
    expect(evaluateHybridSpread(0.95, 1.0501, POLICY).status).toBe('too_wide');
    expect(evaluateHybridSpread(0.31, 0.30, POLICY).status).toBe('crossed');
    expect(evaluateHybridSpread(0, 0.1, POLICY).status).toBe('invalid_quote');
  });

  it('a ceiling below the $0.05 floor is honoured, never clamped up; effective limit is min(ceiling, rule)', () => {
    expect(evaluateHybridSpread(0.28, 0.33, { ...POLICY, ceiling: 0.03 }).reject).toBe(true);
    expect(evaluateHybridSpread(0.28, 0.30, { ...POLICY, ceiling: 0.03 }).reject).toBe(false);
  });
});

describe('parity: shared function, isEligibleCcLeg and evaluatePmccQuoteQuality agree', () => {
  it.each(TABLE)('%s / %s (%s) -> %s', (bid, ask, role, expected) => {
    const shared = evaluateHybridSpread(bid, ask, { ...POLICY, ceiling: ceilingFor(role) });
    // PMCC: open session, fresh timestamp, not delayed, so no earlier status precedence interferes.
    const q = evaluatePmccQuoteQuality(pmccLeg(bid, ask), DEFAULT_PMCC_QUOTE_POLICY, asOf, 'open', role);
    expect(q.structurallyUsable).toBe(!shared.reject);
    expect(q.status === 'wide_warning').toBe(shared.warn);
    expect(q.structurallyUsable).toBe(expected !== 'reject');
    // The covered-call leg is a short leg: same reject decision with the ceiling applied.
    if (role === 'short') expect(ccEligible(bid, ask)).toBe(!shared.reject);
  });
});

describe('evaluatePmccQuoteQuality role handling', () => {
  it('no role = no ceiling (default), long = no ceiling, short = ceiling', () => {
    const wide = pmccLeg(19, 21);
    expect(evaluatePmccQuoteQuality(wide, DEFAULT_PMCC_QUOTE_POLICY, asOf, 'open').structurallyUsable).toBe(true);
    expect(evaluatePmccQuoteQuality(wide, DEFAULT_PMCC_QUOTE_POLICY, asOf, 'open', 'long').structurallyUsable).toBe(true);
    const short = evaluatePmccQuoteQuality(wide, DEFAULT_PMCC_QUOTE_POLICY, asOf, 'open', 'short');
    expect(short.structurallyUsable).toBe(false);
    expect(short.status).toBe('too_wide');
    expect(short.reason).toMatch(/ceiling/);
  });

  it('a $100 LEAP with a 2% width is still eligible as a new-entry long', () => {
    const q = evaluatePmccQuoteQuality(pmccLeg(99, 101), DEFAULT_PMCC_QUOTE_POLICY, asOf, 'open', 'long');
    expect(q.structurallyUsable).toBe(true);
    expect(q.status).toBe('acceptable');
  });

  it('a policy without shortWidthCeiling (older snapshot) applies no ceiling even to a short', () => {
    const { shortWidthCeiling: _omit, ...legacy } = DEFAULT_PMCC_QUOTE_POLICY;
    expect(evaluatePmccQuoteQuality(pmccLeg(19, 21), legacy, asOf, 'open', 'short').structurallyUsable).toBe(true);
  });

  it('maxSpreadPct (qualifyingSpreadPctMax) still overrides the reject percent for shorts, keeping the $0.05 floor', () => {
    const policy = { ...DEFAULT_PMCC_QUOTE_POLICY, qualifyingSpreadPctMax: 20 };
    expect(evaluatePmccQuoteQuality(pmccLeg(1.0, 1.2), policy, asOf, 'open', 'short').structurallyUsable).toBe(true); // 18.2% of mid
    expect(evaluatePmccQuoteQuality(pmccLeg(1.0, 1.4), policy, asOf, 'open', 'short').structurallyUsable).toBe(false); // 33%
    const zero = { ...DEFAULT_PMCC_QUOTE_POLICY, qualifyingSpreadPctMax: 0, acceptableSpreadPctMax: 0 };
    expect(evaluatePmccQuoteQuality(pmccLeg(0.28, 0.33), zero, asOf, 'open', 'short').structurallyUsable).toBe(true); // $0.05 floor
  });

  it('the quote policy validator accepts an omitted ceiling and rejects a non-finite or sub-tick one', () => {
    expect(isValidPmccQuotePolicy(DEFAULT_PMCC_QUOTE_POLICY)).toBe(true);
    const { shortWidthCeiling: _omit, ...legacy } = DEFAULT_PMCC_QUOTE_POLICY;
    expect(isValidPmccQuotePolicy(legacy)).toBe(true);
    expect(isValidPmccQuotePolicy({ ...DEFAULT_PMCC_QUOTE_POLICY, shortWidthCeiling: Number.NaN })).toBe(false);
    expect(isValidPmccQuotePolicy({ ...DEFAULT_PMCC_QUOTE_POLICY, shortWidthCeiling: 0.004 })).toBe(false);
    expect(isValidPmccQuotePolicy({ ...DEFAULT_PMCC_QUOTE_POLICY, shortWidthCeiling: 0.03 })).toBe(true);
  });
});

describe('validateCc (Alan B3 fixtures)', () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0.01, 0, 0.004])('rejects ceiling %s', (v) => {
    expect(validateCc({ WIDTH_PCT_MAX: 10, WIDTH_CEILING: v }).WIDTH_CEILING).toBeTruthy();
  });

  it.each([0.01, 0.03, 0.5])('accepts ceiling %s (a ceiling below the $0.05 floor is valid)', (v) => {
    expect(validateCc({ WIDTH_PCT_MAX: 10, WIDTH_CEILING: v })).toEqual({});
  });

  it('flags a negative or non-finite percent and uses the specified messages', () => {
    expect(validateCc({ WIDTH_PCT_MAX: -1, WIDTH_CEILING: 0.5 }).WIDTH_PCT_MAX).toBe('Max width must be 0 or more.');
    expect(validateCc({ WIDTH_PCT_MAX: Number.NaN, WIDTH_CEILING: 0.5 }).WIDTH_PCT_MAX).toBe('Enter a number.');
    expect(validateCc({ WIDTH_PCT_MAX: 10, WIDTH_CEILING: -0.01 }).WIDTH_CEILING).toBe('Width ceiling must be 0 or more.');
    expect(validateCc({ WIDTH_PCT_MAX: 0, WIDTH_CEILING: 0.5 })).toEqual({});
  });
});

describe('defaults and the shared BID_ASK_MAX key', () => {
  it('CC defaults: 10% of mid and a $0.50 ceiling; BID_ASK_MAX no longer exists on the CC rules', () => {
    expect(DEFAULT_CC_RULES.WIDTH_PCT_MAX).toBe(10);
    expect(DEFAULT_CC_RULES.WIDTH_CEILING).toBe(0.5);
    expect('BID_ASK_MAX' in DEFAULT_CC_RULES).toBe(false);
    expect(DEFAULT_PMCC_QUOTE_POLICY.shortWidthCeiling).toBe(0.5);
  });

  it('CSP, spread and ETF rules keep their dollar BID_ASK_MAX unchanged', () => {
    expect(DEFAULT_CSP_RULES.BID_ASK_MAX).toBe(0.10);
    expect(DEFAULT_RULES.BID_ASK_MAX).toBe(0.10);
    expect(DEFAULT_ETF_RULES.BID_ASK_MAX).toBe(0.25);
    expect(cspFieldErrors({ rules: { ...DEFAULT_CSP_RULES, BID_ASK_MAX: -1 }, popMin: null, otmMin: null, rocMin: null, capitalLimit: null } as never).BID_ASK_MAX).toBe('Enter a number.');
  });
});
