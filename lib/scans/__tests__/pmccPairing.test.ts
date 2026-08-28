import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PMCC_PAIRING_LIMITS,
  DEFAULT_PMCC_QUOTE_POLICY,
} from '../pmccConfig';
import { pairPmccCandidates, pmccDte } from '../pmccPairing';
import type { PmccChainLeg, PmccPairingCriteria } from '../pmccTypes';

const asOf = new Date('2026-08-14T20:00:00.000Z');

const criteria: PmccPairingCriteria = {
  dte: { shortMin: 21, shortMax: 45, longMin: 270, longMax: 730 },
  longDelta: { min: 0.70, max: 0.85 },
  shortDelta: { min: 0.20, max: 0.30 },
  longOiMin: 100,
  shortOiMin: 100,
  requireDebitBelowWidth: true,
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

function run(longLegs: PmccChainLeg[], shortLegs: PmccChainLeg[], overrides: Partial<PmccPairingCriteria> = {}) {
  return pairPmccCandidates({
    symbol: 'GS', underlyingPrice: 1037.55, longLegs, shortLegs,
    criteria: { ...criteria, ...overrides }, asOf, marketSession: 'open',
  });
}

describe('pmccDte', () => {
  it('uses calendar dates rather than time-of-day', () => {
    expect(pmccDte('2026-09-18', asOf)).toBe(35);
    expect(pmccDte('2027-06-18', asOf)).toBe(308);
  });
});

describe('pairPmccCandidates', () => {
  it('returns a complete qualified pair using natural ask/bid economics', () => {
    const result = run([longLeg()], [shortLeg()]);
    expect(result.qualifiedPairs).toHaveLength(1);
    expect(result.nearMissPairs).toHaveLength(0);
    expect(result.qualifiedPairs[0].metrics).toMatchObject({
      netDebitPerShare: 325,
      strikeWidth: 350,
      widthMinusDebitPerShare: 25,
      netDelta: 0.59,
    });
    expect(result.counts).toMatchObject({
      eligibleLongLegs: 1, eligibleShortLegs: 1, potentialCombinations: 1,
      combinationsEvaluated: 1, structurallyValidPairs: 1,
      qualifiedPairsBeforeRetention: 1, qualifiedPairsRetained: 1,
    });
  });

  it('treats submitted delta and DTE boundaries as inclusive', () => {
    const result = run(
      [longLeg({ delta: 0.70, expiration: '2027-05-11', occSymbol: occ('2027-05-11', 720) })],
      [shortLeg({ delta: 0.30, expiration: '2026-09-04', occSymbol: occ('2026-09-04', 1070) })],
      { dte: { shortMin: 21, shortMax: 21, longMin: 270, longMax: 270 } },
    );
    expect(result.qualifiedPairs).toHaveLength(1);
  });

  it('finds an alternate valid pair when the first deterministic pair is a near miss', () => {
    const lowStrike = shortLeg({ strike: 1040, bid: 10, ask: 10.2, occSymbol: occ('2026-09-18', 1040) });
    const result = run([longLeg()], [lowStrike, shortLeg()]);
    expect(result.counts.combinationsEvaluated).toBe(2);
    expect(result.qualifiedPairs).toHaveLength(1);
    expect(result.qualifiedPairs[0].shortLeg.strike).toBe(1070);
  });

  it('retains debit-at-or-above-width pairs in the near-miss audit set', () => {
    const result = run([longLeg()], [shortLeg({ strike: 1050, bid: 5, ask: 5.2, occSymbol: occ('2026-09-18', 1050) })]);
    expect(result.qualifiedPairs).toHaveLength(0);
    expect(result.nearMissPairs[0].primaryFailureReason).toEqual({
      code: 'NET_DEBIT_NOT_BELOW_WIDTH', message: 'Net debit equals or exceeds strike width',
    });
    expect(result.counts.structurallyValidPairs).toBe(1);
  });

  it('does not apply new-long purchase economics to a PMCC based on an exact held LEAPS', () => {
    const held = longLeg({ delta: 0.95, openInterest: 1, bid: 200, ask: 400 });
    const result = pairPmccCandidates({
      symbol: 'GS', underlyingPrice: 1037.55, longLegs: [held], shortLegs: [shortLeg()],
      criteria, asOf, marketSession: 'open', heldLongOccSymbols: new Set([`occ:${held.occSymbol}`]),
    });
    expect(result.qualifiedPairs).toHaveLength(1);
    expect(result.qualifiedPairs[0].longLeg.occSymbol).toBe(held.occSymbol);
  });

  it('ranks OTM short strikes in the requested DTE range instead of rejecting a held PMCC for delta preference', () => {
    const held = longLeg();
    const outsidePreferredDelta = shortLeg({ delta: 0.32, strike: 1080, occSymbol: occ('2026-09-18', 1080) });
    const nearerPreferredDelta = shortLeg({ delta: 0.27, strike: 1090, occSymbol: occ('2026-09-18', 1090) });
    const result = pairPmccCandidates({
      symbol: 'GS', underlyingPrice: 1037.55, longLegs: [held], shortLegs: [outsidePreferredDelta, nearerPreferredDelta],
      criteria, asOf, marketSession: 'open', heldLongOccSymbols: new Set([`occ:${held.occSymbol}`]),
    });
    expect(result.qualifiedPairs.map(pair => pair.shortLeg.strike)).toEqual([1090, 1080]);
  });

  it('reports distinct leg rejections when no long or short is eligible', () => {
    const result = run(
      [longLeg({ delta: 0.60 })],
      [shortLeg({ openInterest: 99 })],
    );
    expect(result.counts.potentialCombinations).toBe(0);
    expect(result.legRejections).toHaveLength(2);
    expect(result.legRejections[0].reasons.map(item => item.code)).toContain('DELTA_OUT_OF_RANGE');
    expect(result.legRejections[1].reasons.map(item => item.code)).toContain('OPEN_INTEREST_BELOW_MINIMUM');
  });

  it('deduplicates matching OCC contracts before pairing', () => {
    const repeated = longLeg();
    const result = run([repeated, { ...repeated }], [shortLeg()]);
    expect(result.counts.eligibleLongLegs).toBe(1);
    expect(result.legRejections.flatMap(item => item.reasons.map(reason => reason.code))).toContain('DUPLICATE_CONTRACT');
  });

  it.each([
    [longLeg({ optionType: 'P' }), 'INVALID_OPTION_TYPE'],
    [longLeg({ underlyingSymbol: 'IBM' }), 'UNDERLYING_MISMATCH'],
    [longLeg({ occSymbol: 'bad' }), 'INVALID_OCC_IDENTITY'],
    [longLeg({ delta: 0.69 }), 'DELTA_OUT_OF_RANGE'],
    [longLeg({ openInterest: 99 }), 'OPEN_INTEREST_BELOW_MINIMUM'],
    [longLeg({ bid: 300, ask: 400 }), 'BID_ASK_TOO_WIDE'],
    [longLeg({ strike: 1050, occSymbol: occ('2027-06-18', 1050) }), 'LONG_NOT_ITM'],
    [longLeg({ ask: 300 }), 'INVALID_EXTRINSIC'],
  ] as const)('rejects an individually ineligible long leg: %s', (input, code) => {
    const result = run([input], [shortLeg()]);
    expect(result.legRejections[0].reasons.map(item => item.code)).toContain(code);
  });

  it('keeps all applicable pair failure reasons with a deterministic primary reason', () => {
    const result = run(
      [longLeg({ expiration: '2026-09-04', occSymbol: occ('2026-09-04', 720) })],
      [shortLeg({ expiration: '2026-09-18', strike: 1050, bid: 5, ask: 5.2, occSymbol: occ('2026-09-18', 1050) })],
      { dte: { shortMin: 21, shortMax: 45, longMin: 21, longMax: 45 } },
    );
    const codes = result.nearMissPairs[0].failureReasons.map(item => item.code);
    expect(codes).toEqual(expect.arrayContaining(['LONG_EXPIRATION_NOT_LATER', 'NET_DEBIT_NOT_BELOW_WIDTH']));
    expect(result.nearMissPairs[0].primaryFailureReason?.code).toBe('LONG_EXPIRATION_NOT_LATER');
  });

  it('reconciles independent safety and retention accounting', () => {
    const longLegs = Array.from({ length: 4 }, (_, i) => longLeg({ strike: 700 + i, occSymbol: occ('2027-06-18', 700 + i) }));
    const shortLegs = Array.from({ length: 4 }, (_, i) => shortLeg({ strike: 1060 + i, occSymbol: occ('2026-09-18', 1060 + i) }));
    const result = run(longLegs, shortLegs, {
      limits: { maxCombinationsEvaluated: 12, maxQualifiedPairsRetained: 3, maxNearMissPairsRetained: 2 },
    });
    expect(result.counts.potentialCombinations).toBe(16);
    expect(result.counts.combinationsEvaluated + result.counts.combinationsOmittedBySafetyLimit).toBe(16);
    expect(result.counts.qualifiedPairsRetained + result.counts.qualifiedPairsOmittedByRetention).toBe(result.counts.qualifiedPairsBeforeRetention);
    expect(result.counts.nearMissPairsRetained + result.counts.nearMissPairsOmittedByRetention).toBe(result.counts.nearMissPairsBeforeRetention);
    expect(result.incompleteAnalysis).toBe(true);
  });

  it('produces byte-identical partial output for identical explicit inputs', () => {
    const longLegs = Array.from({ length: 5 }, (_, i) => longLeg({ strike: 700 + i, occSymbol: occ('2027-06-18', 700 + i) }));
    const shortLegs = Array.from({ length: 5 }, (_, i) => shortLeg({ strike: 1060 + i, occSymbol: occ('2026-09-18', 1060 + i) }));
    const limited = { limits: { maxCombinationsEvaluated: 10, maxQualifiedPairsRetained: 10, maxNearMissPairsRetained: 10 } };
    expect(JSON.stringify(run(longLegs, shortLegs, limited))).toBe(JSON.stringify(run(longLegs, shortLegs, limited)));
  });
  it.each([
    { acceptableSpreadPctMax: -1, qualifyingSpreadPctMax: 10, readyQuoteAgeSecondsMax: 120 },
    { acceptableSpreadPctMax: 11, qualifyingSpreadPctMax: 10, readyQuoteAgeSecondsMax: 120 },
    { acceptableSpreadPctMax: 5, qualifyingSpreadPctMax: -1, readyQuoteAgeSecondsMax: 120 },
    { acceptableSpreadPctMax: 5, qualifyingSpreadPctMax: 10, readyQuoteAgeSecondsMax: 0 },
    { acceptableSpreadPctMax: Number.NaN, qualifyingSpreadPctMax: 10, readyQuoteAgeSecondsMax: 120 },
  ])('throws a clear configuration error for invalid quote policy %j', quotePolicy => {
    expect(() => run([longLeg()], [shortLeg()], { quotePolicy })).toThrow('Invalid PMCC quote policy');
  });

  it('accepts a valid custom quote policy', () => {
    const result = run([longLeg()], [shortLeg()], {
      quotePolicy: { acceptableSpreadPctMax: 4, qualifyingSpreadPctMax: 8, readyQuoteAgeSecondsMax: 90 },
    });
    expect(result.counts.combinationsEvaluated).toBe(1);
  });

});
