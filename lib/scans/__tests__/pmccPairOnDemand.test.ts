import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PMCC_PAIRING_LIMITS,
  DEFAULT_PMCC_QUOTE_POLICY,
} from '../pmccConfig';
import { evaluatePmccPairOnDemand, pairPmccCandidates } from '../pmccPairing';
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

function check(long: PmccChainLeg | null, short: PmccChainLeg | null, overrides: Partial<PmccPairingCriteria> = {}) {
  return evaluatePmccPairOnDemand({
    symbol: 'GS', underlyingPrice: 1037.55,
    longChainLeg: long, shortChainLeg: short,
    criteria: { ...criteria, ...overrides }, asOf, marketSession: 'open',
  });
}

describe('evaluatePmccPairOnDemand', () => {
  it('outcome: not_found_in_chain when the requested long leg does not exist', () => {
    const result = check(null, shortLeg());
    expect(result.outcome).toBe('not_found_in_chain');
    expect(result.chainMissing).toEqual({ long: true, short: false });
    expect(result.pair).toBeNull();
  });

  it('outcome: not_found_in_chain when the requested short leg does not exist', () => {
    const result = check(longLeg(), null);
    expect(result.outcome).toBe('not_found_in_chain');
    expect(result.chainMissing).toEqual({ long: false, short: true });
  });

  it('outcome: not_found_in_chain when both legs are missing', () => {
    const result = check(null, null);
    expect(result.outcome).toBe('not_found_in_chain');
    expect(result.chainMissing).toEqual({ long: true, short: true });
  });

  it('outcome: leg_rejected when the long leg exists but fails its own eligibility gate (delta out of range)', () => {
    const result = check(longLeg({ delta: 0.40 }), shortLeg());
    expect(result.outcome).toBe('leg_rejected');
    expect(result.longLegRejection?.reasons.some(r => r.code === 'DELTA_OUT_OF_RANGE')).toBe(true);
    expect(result.shortLegRejection).toBeNull();
  });

  it('outcome: leg_rejected when the short leg exists but fails its own eligibility gate (OI below minimum)', () => {
    const result = check(longLeg(), shortLeg({ openInterest: 5 }));
    expect(result.outcome).toBe('leg_rejected');
    expect(result.shortLegRejection?.reasons.some(r => r.code === 'OPEN_INTEREST_BELOW_MINIMUM')).toBe(true);
  });

  it('outcome: pair_rejected when both legs are individually eligible but net debit is not positive', () => {
    // Both legs individually eligible (long ITM, short OTM, delta/OI/DTE
    // all in range) but the short leg's bid exceeds the long leg's ask,
    // making net debit zero or negative -- a real structural failure that
    // can't happen at the individual-leg level.
    const result = check(
      longLeg({ ask: 318, bid: 317 }),
      shortLeg({ bid: 320, ask: 320.5 }),
    );
    expect(result.outcome).toBe('pair_rejected');
    expect(result.pair?.failureReasons.some(r => r.code === 'NET_DEBIT_NOT_POSITIVE')).toBe(true);
  });

  it('outcome: qualified for a fully valid pair', () => {
    const result = check(longLeg(), shortLeg());
    expect(result.outcome).toBe('qualified');
    expect(result.pair?.qualified).toBe(true);
  });

  it('outcome: near_miss for a structurally valid pair that fails only requireDebitBelowWidth', () => {
    const result = check(
      longLeg({ bid: 1000, ask: 1000 }), // inflates net debit above the strike width
      shortLeg(),
    );
    expect(result.outcome).toBe('near_miss');
    expect(result.pair?.qualified).toBe(false);
    expect(result.pair?.failureReasons.some(r => r.code === 'NET_DEBIT_NOT_BELOW_WIDTH')).toBe(true);
  });

  it('THE MOTIVATING CASE: a pair that is genuinely qualified by the full scan, but truncated out of the retained top-N, is confirmed real and qualified via the on-demand check', () => {
    // Build 12 valid long legs so the full scan's retention limit (10)
    // truncates at least one qualified pair out of the visible set --
    // reproducing exactly the frustration that motivated this ticket:
    // a real, valid structure disappearing from view purely because of
    // where it falls in "Contract order," not because it was disqualified.
    const longLegs = Array.from({ length: 12 }, (_, i) => {
      const strike = 600 + i * 5;
      const intrinsic = 1037.55 - strike;
      const ask = intrinsic + 30; // fixed extrinsic buffer, keeps every leg
                                   // comfortably valid regardless of strike
      return longLeg({ strike, ask, bid: ask - 1, occSymbol: occ('2027-06-18', strike) });
    });
    const shortLegs = [shortLeg()];

    const fullScan = pairPmccCandidates({
      symbol: 'GS', underlyingPrice: 1037.55, longLegs, shortLegs,
      criteria: { ...criteria, limits: { ...DEFAULT_PMCC_PAIRING_LIMITS, maxQualifiedPairsRetained: 10 } },
      asOf, marketSession: 'open',
    });

    expect(fullScan.counts.qualifiedPairsOmittedByRetention).toBeGreaterThan(0);
    expect(fullScan.qualifiedPairs.length).toBe(10);

    // The 12th long leg (highest strike, sorts last in Contract order) is
    // exactly the kind of pair that gets omitted.
    const omittedLongLeg = longLegs[11];
    expect(fullScan.qualifiedPairs.some(p => p.longLeg.occSymbol === omittedLongLeg.occSymbol)).toBe(false);

    // The on-demand check proves it independently: real, valid, qualified
    // -- just not one of the 10 shown. This is the distinction a person
    // needs and the retained session summary alone cannot provide.
    const onDemand = check(omittedLongLeg, shortLegs[0]);
    expect(onDemand.outcome).toBe('qualified');
    expect(onDemand.pair?.longLeg.occSymbol).toBe(omittedLongLeg.occSymbol);
  });

  it('always evaluates against the criteria passed in, never a cached value -- per Alan\'s requirement', () => {
    // Same pair, two different criteria objects in the same test run.
    // A tight long-delta range that excludes this leg's actual delta (0.82).
    const tight = check(longLeg(), shortLeg(), { longDelta: { min: 0.70, max: 0.80 } });
    expect(tight.outcome).toBe('leg_rejected');

    // The default (unmodified) criteria used everywhere else in this file
    // accepts the same leg -- proving the function has no memoized/stale
    // criteria carried over from the prior call.
    const normal = check(longLeg(), shortLeg());
    expect(normal.outcome).toBe('qualified');
  });
});
