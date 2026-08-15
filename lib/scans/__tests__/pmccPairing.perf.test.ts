import { describe, expect, it } from 'vitest';
import { DEFAULT_PMCC_QUOTE_POLICY } from '../pmccConfig';
import { pairPmccCandidates } from '../pmccPairing';
import type { PmccChainLeg, PmccPairingCriteria } from '../pmccTypes';

const asOf = new Date('2026-08-14T20:00:00.000Z');

function occ(expiration: string, strike: number): string {
  return `GS${expiration.slice(2).replace(/-/g, '')}C${String(Math.round(strike * 1000)).padStart(8, '0')}`;
}

function makeLeg(expiration: string, strike: number, role: 'long' | 'short'): PmccChainLeg {
  return {
    underlyingSymbol: 'GS', optionType: 'C', expiration, strike,
    delta: role === 'long' ? 0.80 : 0.25,
    openInterest: 1_000,
    bid: role === 'long' ? 345 : 20,
    ask: role === 'long' ? 347 : 20.5,
    occSymbol: occ(expiration, strike),
    quoteTimestamp: '2026-08-14T19:59:30.000Z', delayed: false,
  };
}

const criteria: PmccPairingCriteria = {
  dte: { shortMin: 21, shortMax: 70, longMin: 270, longMax: 730 },
  longDelta: { min: 0.70, max: 0.85 }, shortDelta: { min: 0.20, max: 0.30 },
  longOiMin: 100, shortOiMin: 100, requireDebitBelowWidth: true,
  quotePolicy: DEFAULT_PMCC_QUOTE_POLICY,
  limits: { maxCombinationsEvaluated: 25_000, maxQualifiedPairsRetained: 10, maxNearMissPairsRetained: 10 },
};

describe('PMCC dense-chain safety limit', () => {
  it('terminates deterministically at exactly 25,000 evaluated combinations', () => {
    const longExpirations = ['2027-06-18', '2027-09-17'];
    const shortExpirations = ['2026-09-18', '2026-10-16'];
    const longLegs = longExpirations.flatMap((expiration, expirationIndex) =>
      Array.from({ length: 100 }, (_, index) => makeLeg(expiration, 700 + expirationIndex * 100 + index, 'long')),
    );
    const shortLegs = shortExpirations.flatMap((expiration, expirationIndex) =>
      Array.from({ length: 100 }, (_, index) => makeLeg(expiration, 1050 + expirationIndex * 100 + index, 'short')),
    );
    const input = {
      symbol: 'GS', underlyingPrice: 1037.55, longLegs, shortLegs,
      criteria, asOf, marketSession: 'open' as const,
    };
    const first = pairPmccCandidates(input);
    const second = pairPmccCandidates(input);

    expect(first.counts.eligibleLongLegs).toBe(200);
    expect(first.counts.eligibleShortLegs).toBe(200);
    expect(first.counts.potentialCombinations).toBe(40_000);
    expect(first.counts.combinationsEvaluated).toBe(25_000);
    expect(first.counts.combinationsOmittedBySafetyLimit).toBe(15_000);
    expect(first.incompleteAnalysis).toBe(true);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
