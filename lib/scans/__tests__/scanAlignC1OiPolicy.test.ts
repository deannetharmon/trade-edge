// lib/scans/__tests__/scanAlignC1OiPolicy.test.ts
//
// SCAN-ALIGN-0001C1 -- open-interest policy. Alan's golden fixtures 1-11,
// the CC ranking determinism tests, and the CC OI display row.

import { describe, expect, it } from 'vitest';
import { DEFAULT_PMCC_PAIRING_LIMITS, DEFAULT_PMCC_QUOTE_POLICY } from '../pmccConfig';
import { pairPmccCandidates } from '../pmccPairing';
import { heldLongKey } from '../pmccHeldBreakeven';
import { evaluatePmccDecision } from '../pmccDecision';
import { selectAllEligibleCcContracts } from '../covered-call-finder';
import { buildCcOiCheck } from '../ccOiDisplay';
import type { PmccChainLeg, PmccPairingCriteria } from '../pmccTypes';

const asOf = new Date('2026-08-14T20:00:00.000Z');
const M = 100;

const criteria: PmccPairingCriteria = {
  dte: { shortMin: 21, shortMax: 45, longMin: 270, longMax: 730 },
  longDelta: { min: 0.70, max: 0.85 },
  shortDelta: { min: 0.20, max: 0.30 },
  longOiMin: M,
  shortOiMin: M,
  quotePolicy: DEFAULT_PMCC_QUOTE_POLICY,
  limits: DEFAULT_PMCC_PAIRING_LIMITS,
};

function occ(expiration: string, strike: number): string {
  const date = expiration.slice(2).replace(/-/g, '');
  return `GS${date}C${String(Math.round(strike * 1000)).padStart(8, '0')}`;
}

function longLeg(overrides: Partial<PmccChainLeg> = {}): PmccChainLeg {
  const expiration = overrides.expiration ?? '2027-06-18';
  const strike = overrides.strike ?? 720;
  return {
    underlyingSymbol: 'GS', optionType: 'C', expiration, strike,
    delta: 0.82, openInterest: 500, bid: 345, ask: 347,
    occSymbol: occ(expiration, strike), quoteTimestamp: '2026-08-14T19:59:30.000Z', delayed: false,
    ...overrides,
  };
}

function shortLeg(overrides: Partial<PmccChainLeg> = {}): PmccChainLeg {
  const expiration = overrides.expiration ?? '2026-09-18';
  const strike = overrides.strike ?? 1070;
  return {
    underlyingSymbol: 'GS', optionType: 'C', expiration, strike,
    delta: 0.23, openInterest: 500, bid: 22, ask: 22.5,
    occSymbol: occ(expiration, strike), quoteTimestamp: '2026-08-14T19:59:30.000Z', delayed: false,
    ...overrides,
  };
}

function run(longLegs: PmccChainLeg[], shortLegs: PmccChainLeg[], held?: PmccChainLeg, withBasis = true) {
  return pairPmccCandidates({
    symbol: 'GS', underlyingPrice: 1037.55, longLegs, shortLegs, criteria, asOf, marketSession: 'open',
    ...(held ? {
      heldLongOccSymbols: new Set([heldLongKey(held.occSymbol!)]),
      heldLongBasis: withBasis ? new Map([[heldLongKey(held.occSymbol!), { avgOpen: 345, quantity: 1 }]]) : undefined,
    } : {}),
  });
}

const codes = (result: ReturnType<typeof run>, role: 'long' | 'short') =>
  result.legRejections.filter(r => r.role === role).flatMap(r => r.reasons.map(x => x.code));

describe('fixtures 1-3: PMCC short OI is a warning, not a gate', () => {
  it('1. OI = M is eligible with no OI warning', () => {
    const result = run([longLeg()], [shortLeg({ openInterest: M })]);
    expect(result.qualifiedPairs).toHaveLength(1);
    const decision = evaluatePmccDecision({ pair: result.qualifiedPairs[0], criteria, marketSession: 'open' });
    expect(decision.gates.some(g => g.code === 'NEW_SHORT_OI')).toBe(false);
  });

  it.each([M - 1, 0])('2/3. OI = %s is eligible, reaches qualifiedPairs, warns, and is not OPEN_INTEREST_BELOW_MINIMUM', oi => {
    const result = run([longLeg()], [shortLeg({ openInterest: oi })]);
    expect(result.qualifiedPairs).toHaveLength(1);
    expect(codes(result, 'short')).not.toContain('OPEN_INTEREST_BELOW_MINIMUM');
    const decision = evaluatePmccDecision({ pair: result.qualifiedPairs[0], criteria, marketSession: 'open' });
    const warn = decision.gates.find(g => g.code === 'NEW_SHORT_OI');
    expect(warn?.status).toBe('warning');
    expect(decision.qualification).toBe('QUALIFIED');
  });
});

describe('fixtures 4-5: PMCC short with invalid OI rejects INSUFFICIENT_DATA', () => {
  it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1])('OI = %s', oi => {
    const result = run([longLeg()], [shortLeg({ openInterest: oi as unknown as number })]);
    expect(result.qualifiedPairs).toHaveLength(0);
    expect(result.counts.eligibleShortLegs).toBe(0);
    const rejection = result.legRejections.find(r => r.role === 'short');
    expect(rejection?.reasons.map(r => r.code)).toEqual(['INSUFFICIENT_DATA']);
    expect(rejection?.reasons[0].message).toBe('Open interest is missing or invalid');
  });
});

describe('fixtures 6-7: a new LEAP keeps the hard OI reject', () => {
  it.each([[M, null], [M - 1, 'OPEN_INTEREST_BELOW_MINIMUM'], [0, 'OPEN_INTEREST_BELOW_MINIMUM']] as const)('OI = %s', (oi, code) => {
    const result = run([longLeg({ openInterest: oi })], [shortLeg()]);
    if (code == null) expect(result.counts.eligibleLongLegs).toBe(1);
    else expect(codes(result, 'long')).toContain(code);
  });

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY])('OI = %s is INSUFFICIENT_DATA', oi => {
    const result = run([longLeg({ openInterest: oi as unknown as number })], [shortLeg()]);
    expect(codes(result, 'long')).toEqual(['INSUFFICIENT_DATA']);
  });
});

describe('fixtures 8-9: held longs skip the OI check entirely', () => {
  it.each([50, 0, null, Number.NaN])('8. held long OI = %s is eligible with no OI reason and reaches the floor', oi => {
    const held = longLeg({ openInterest: oi as unknown as number });
    const result = run([held], [shortLeg()], held);
    expect(result.counts.eligibleLongLegs).toBe(1);
    expect(codes(result, 'long')).toEqual([]);
    expect(result.qualifiedPairs).toHaveLength(1);
    expect(result.qualifiedPairs[0].failureReasons).toEqual([]);
    const decision = evaluatePmccDecision({ pair: { ...result.qualifiedPairs[0], entryMode: 'covered-short-call-against-held-leaps' }, criteria, marketSession: 'open' });
    // The pre-existing HELD_LONG_OI_PREFERENCE warning covers a real value below the minimum
    // (50, 0); a missing/invalid value raises no OI gate at all.
    expect(decision.gates.some(g => g.code === 'HELD_LONG_OI_PREFERENCE')).toBe(typeof oi === 'number' && Number.isFinite(oi) && oi < M);
    expect(decision.qualification).toBe('QUALIFIED');
  });

  it('8b. a held long that fails the floor fails on price only, never an OI code', () => {
    const held = longLeg({ openInterest: null });
    const result = pairPmccCandidates({
      symbol: 'GS', underlyingPrice: 1037.55, longLegs: [held], shortLegs: [shortLeg()], criteria, asOf, marketSession: 'open',
      heldLongOccSymbols: new Set([heldLongKey(held.occSymbol!)]),
      heldLongBasis: new Map([[heldLongKey(held.occSymbol!), { avgOpen: 900, quantity: 1 }]]),
    });
    const all = [...result.qualifiedPairs, ...result.nearMissPairs].flatMap(p => p.failureReasons.map(r => r.code));
    expect(all).toContain('SHORT_NOT_ABOVE_HELD_BREAKEVEN');
    expect(all.some(c => c === 'OPEN_INTEREST_BELOW_MINIMUM' || c === 'INSUFFICIENT_DATA')).toBe(false);
  });

  it('9. held long with null OI and no basis reaches the floor: COST_BASIS_UNAVAILABLE', () => {
    const held = longLeg({ openInterest: null });
    const result = run([held], [shortLeg()], held, false);
    expect(codes(result, 'long')).toEqual([]);
    expect(result.nearMissPairs[0].failureReasons.map(r => r.code)).toEqual(['COST_BASIS_UNAVAILABLE']);
  });
});

describe('invariants on PmccEligibleLeg.openInterest', () => {
  it('non-held eligible legs always have finite, non-null OI', () => {
    const result = run(
      [longLeg(), longLeg({ strike: 700, occSymbol: occ('2027-06-18', 700), openInterest: null })],
      [shortLeg({ openInterest: 0 }), shortLeg({ strike: 1080, occSymbol: occ('2026-09-18', 1080), openInterest: Number.NaN })],
    );
    for (const pair of [...result.qualifiedPairs, ...result.nearMissPairs]) {
      for (const leg of [pair.longLeg, pair.shortLeg]) {
        expect(leg.openInterest).not.toBeNull();
        expect(Number.isFinite(leg.openInterest as number)).toBe(true);
      }
    }
  });

  it('every leg rejection carries at least one reason code', () => {
    const legs = [
      longLeg({ openInterest: null }), longLeg({ optionType: 'P', strike: 710, occSymbol: occ('2027-06-18', 710) }),
      longLeg({ strike: 700, occSymbol: occ('2027-06-18', 700), openInterest: 0 }),
    ];
    const held = legs[0];
    for (const heldArg of [undefined, held]) {
      const result = run(legs, [shortLeg({ openInterest: null }), shortLeg({ strike: 1080, occSymbol: occ('2026-09-18', 1080), openInterest: -5 })], heldArg);
      expect(result.legRejections.length).toBeGreaterThan(0);
      for (const rejection of result.legRejections) expect(rejection.reasons.length).toBeGreaterThan(0);
    }
  });
});

// ── Covered call ────────────────────────────────────────────────────────────

function isoDate(daysOut: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOut);
  return d.toISOString().slice(0, 10);
}

interface CcLeg { strike: number; oi: unknown; delta?: number; bid?: number; ask?: number }

function ccChain(legs: CcLeg[], dte = 30) {
  const exp = isoDate(dte);
  return {
    expirations: [exp],
    chains: {
      [exp]: legs.map(l => ({
        strikePrice: l.strike, expirationDate: exp, optionType: 'C' as const, delta: l.delta ?? 0.28,
        openInterest: l.oi as number, bid: l.bid ?? 1.2, ask: l.ask ?? 1.3, mid: 1.25, occSymbol: `T${l.strike}`,
      })),
    },
  } as unknown as { expirations: string[]; chains: Record<string, never[]> };
}

const CC_PARAMS = {
  deltaTarget: { min: 0.2, max: 0.35 }, dteTarget: { min: 21, max: 45 }, minStrike: null, oiMin: 500, widthPctMax: 10, widthCeiling: 0.5,
};
const pick = (chain: ReturnType<typeof ccChain>) => selectAllEligibleCcContracts(chain as never, CC_PARAMS);

describe('fixture 10: CC leg with missing/invalid OI is excluded; a good leg survives', () => {
  it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -1])('OI = %s', oi => {
    const result = pick(ccChain([{ strike: 105, oi }, { strike: 110, oi: 800 }]));
    expect(result.map(c => c.strikePrice)).toEqual([110]);
  });
});

describe('fixture 11: CC OI at / below the minimum stays eligible', () => {
  it.each([500, 499, 0])('OI = %s', oi => {
    expect(pick(ccChain([{ strike: 105, oi }])).map(c => c.openInterest)).toEqual([oi]);
  });
});

describe('CC ranking is deterministic', () => {
  const legs: CcLeg[] = [{ strike: 105, oi: 500 }, { strike: 106, oi: 300 }, { strike: 107, oi: 0 }];
  const permutations = (arr: CcLeg[]): CcLeg[][] => arr.length <= 1 ? [arr]
    : arr.flatMap((x, i) => permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map(rest => [x, ...rest]));

  it('OI 500 vs 300 vs 0 at equal delta ranks 500, 300, 0 for every input order', () => {
    for (const perm of permutations(legs)) {
      expect(pick(ccChain(perm)).map(c => c.openInterest)).toEqual([500, 300, 0]);
    }
  });

  it('full ties end on strike ascending, for every input order', () => {
    const tied: CcLeg[] = [{ strike: 107, oi: 500 }, { strike: 105, oi: 500 }, { strike: 106, oi: 500 }];
    for (const perm of permutations(tied)) {
      expect(pick(ccChain(perm)).map(c => c.strikePrice)).toEqual([105, 106, 107]);
    }
  });

  it('no NaN delta or strike reaches the comparator', () => {
    const result = pick(ccChain([{ strike: 105, oi: 500, delta: Number.NaN }, { strike: Number.NaN, oi: 500 }, { strike: 108, oi: 500 }]));
    expect(result.map(c => c.strikePrice)).toEqual([108]);
  });
});

describe('CC OI display row (page.tsx checklist)', () => {
  const OI_MIN = 500;
  it('500 passes with "≥ 500 minimum"', () => {
    expect(buildCcOiCheck(500, OI_MIN)).toEqual({ status: 'pass', value: '500', reason: '≥ 500 minimum' });
  });
  it('499 warns "Below 500"', () => {
    const r = buildCcOiCheck(499, OI_MIN);
    expect(r.status).toBe('warn');
    expect(r.value).toBe('499');
    expect(r.reason).toMatch(/^Below 500/);
  });
  it('0 warns and shows "0"', () => {
    const r = buildCcOiCheck(0, OI_MIN);
    expect(r.status).toBe('warn');
    expect(r.value).toBe('0');
  });
  it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY])('%s renders an em dash and "Open interest unavailable"', oi => {
    const r = buildCcOiCheck(oi, OI_MIN);
    expect(r).toEqual({ status: 'warn', value: '—', reason: 'Open interest unavailable' });
    expect(`${r.value} ${r.reason}`).not.toMatch(/NaN|null|undefined/);
  });
});
