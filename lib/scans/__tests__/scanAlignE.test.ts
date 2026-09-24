// lib/scans/__tests__/scanAlignE.test.ts

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PMCC_LONG_DELTA_RANGE, DEFAULT_PMCC_PAIRING_LIMITS, DEFAULT_PMCC_QUOTE_POLICY,
  DEFAULT_PMCC_SHORT_DELTA_RANGE, isValidPmccScanSnapshot, stripLegacyPmccCriteria,
} from '../pmccConfig';
import { PMCC_DECISION_POLICY_VERSION } from '../pmccDecision';
import { DEFAULT_PMCC_DTE_RANGES } from '../pmccDteRanges';
import { pairPmccCandidates } from '../pmccPairing';
import type { PmccChainLeg, PmccPairingCriteria } from '../pmccTypes';

// SCAN-ALIGN-0001E fixtures: long strike 80, long ask 24.10, short bid 1.60, debit 22.50.
const asOf = new Date('2026-08-14T20:00:00.000Z');
const criteria: PmccPairingCriteria = {
  dte: { shortMin: 21, shortMax: 45, longMin: 270, longMax: 730 },
  longDelta: { min: 0.70, max: 0.85 }, shortDelta: { min: 0.20, max: 0.30 },
  longOiMin: 100, shortOiMin: 100,
  quotePolicy: DEFAULT_PMCC_QUOTE_POLICY, limits: DEFAULT_PMCC_PAIRING_LIMITS,
};
const occ = (expiration: string, strike: number) => `GS${expiration.slice(2).replace(/-/g, '')}C${String(Math.round(strike * 1000)).padStart(8, '0')}`;
const longLeg = (): PmccChainLeg => ({
  underlyingSymbol: 'GS', optionType: 'C', expiration: '2027-06-18', strike: 80, delta: 0.8, openInterest: 500,
  bid: 24.0, ask: 24.10, occSymbol: occ('2027-06-18', 80), quoteTimestamp: '2026-08-14T19:59:30.000Z', delayed: false,
});
const shortLeg = (strike: number): PmccChainLeg => ({
  underlyingSymbol: 'GS', optionType: 'C', expiration: '2026-09-18', strike, delta: 0.25, openInterest: 500,
  bid: 1.60, ask: 1.65, occSymbol: occ('2026-09-18', strike), quoteTimestamp: '2026-08-14T19:59:30.000Z', delayed: false,
});
const pair = (shortStrike: number, crit: unknown = criteria) => pairPmccCandidates({
  symbol: 'GS', underlyingPrice: 92.5, longLegs: [longLeg()], shortLegs: [shortLeg(shortStrike)],
  criteria: crit as PmccPairingCriteria, asOf, marketSession: 'open',
});

describe('SCAN-ALIGN-0001E E1: requireDebitBelowWidth is no longer a criterion', () => {
  it('criteria without the field are valid and debit = width - 0.01 qualifies', () => {
    expect(pair(102.51).qualifiedPairs).toHaveLength(1);
  });
  it('debit = width and width + 0.01 do not qualify', () => {
    for (const strike of [102.5, 102.49]) {
      const result = pair(strike);
      expect(result.qualifiedPairs).toHaveLength(0);
      expect(result.counts.qualifiedPairsBeforeRetention).toBe(0);
    }
  });
  it('a saved requireDebitBelowWidth:false is ignored: equality still does not qualify', () => {
    const legacy = { ...criteria, requireDebitBelowWidth: false };
    expect(pair(102.5, legacy).qualifiedPairs).toHaveLength(0);
    expect(pair(102.51, legacy).qualifiedPairs).toHaveLength(1);
  });
  it('an unknown extra criteria key is ignored, not rejected', () => {
    expect(() => pair(102.51, { ...criteria, somethingElse: 1 })).not.toThrow();
  });

  const snapshot = (extra: Record<string, unknown> = {}) => ({
    asOf: asOf.toISOString(), marketSession: 'open', decisionPolicyVersion: PMCC_DECISION_POLICY_VERSION,
    criteria: {
      dte: DEFAULT_PMCC_DTE_RANGES, longDelta: DEFAULT_PMCC_LONG_DELTA_RANGE, shortDelta: DEFAULT_PMCC_SHORT_DELTA_RANGE,
      longOiMin: 100, shortOiMin: 100, quotePolicy: DEFAULT_PMCC_QUOTE_POLICY, limits: DEFAULT_PMCC_PAIRING_LIMITS, ...extra,
    },
  });
  it('isValidPmccScanSnapshot accepts an old snapshot with the field (true or false) and one without', () => {
    expect(isValidPmccScanSnapshot(snapshot())).toBe(true);
    expect(isValidPmccScanSnapshot(snapshot({ requireDebitBelowWidth: true }))).toBe(true);
    expect(isValidPmccScanSnapshot(snapshot({ requireDebitBelowWidth: false }))).toBe(true);
  });
  it('stripLegacyPmccCriteria drops a saved false and leaves other snapshots untouched', () => {
    const old = snapshot({ requireDebitBelowWidth: false });
    const stripped = stripLegacyPmccCriteria(old);
    expect('requireDebitBelowWidth' in stripped.criteria).toBe(false);
    expect(stripped.criteria.longOiMin).toBe(100);
    expect('requireDebitBelowWidth' in old.criteria).toBe(true);
    const clean = snapshot();
    expect(stripLegacyPmccCriteria(clean)).toBe(clean);
    expect(stripLegacyPmccCriteria(null)).toBeNull();
  });
});
