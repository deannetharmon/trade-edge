import { describe, expect, it } from 'vitest';
import { buildPmccDecisionCardMetrics, pmccCycleExpirations, pmccTargetStatus } from '../pmccDecisionCard';
import type { PmccPairResult, PmccPairingCriteria } from '../pmccTypes';
import { DEFAULT_PMCC_PAIRING_LIMITS, DEFAULT_PMCC_QUOTE_POLICY } from '../pmccConfig';

const criteria: PmccPairingCriteria = {
  dte: { shortMin: 25, shortMax: 35, longMin: 270, longMax: 730 },
  longDelta: { min: 0.70, max: 0.85 }, shortDelta: { min: 0.25, max: 0.30 },
  longOiMin: 100, shortOiMin: 100, requireDebitBelowWidth: true,
  quotePolicy: DEFAULT_PMCC_QUOTE_POLICY, limits: DEFAULT_PMCC_PAIRING_LIMITS,
};

const pair = {
  pairId: 'pair', symbol: 'MU', qualified: true, insufficientData: false,
  failureReasons: [], primaryFailureReason: null, orderingLabel: 'Contract order',
  longLeg: { expiration: '2027-06-17', dte: 303, strike: 600, delta: 0.84, executablePrice: 429.85 },
  shortLeg: { expiration: '2026-09-17', dte: 30, strike: 1100, delta: 0.27, executablePrice: 18 },
  metrics: { netDebitPerShare: 411.85 },
} as unknown as PmccPairResult;

describe('PMCC decision-card calculation contract', () => {
  it('calculates cash outlay and current executable credit in contract dollars', () => {
    const result = buildPmccDecisionCardMetrics({ pair, underlyingPrice: 944.40, criteria });
    expect(result.shareCost).toBe(94_440);
    expect(result.longCallCost).toBe(42_985);
    expect(result.currentCycleCredit).toBe(1_800);
    expect(result.initialNetDebit).toBe(41_185);
    expect(result.cashOutlayReduction).toBe(53_255);
    expect(result.cashOutlayReductionPct).toBeCloseTo(56.39, 2);
    expect(result.currentCycleCreditPct).toBeCloseTo(4.37, 2);
  });

  it('uses the approved target, near-target, and outside-target tolerances', () => {
    expect(pmccTargetStatus(pair, criteria)).toBe('target_match');
    expect(pmccTargetStatus({ ...pair, shortLeg: { ...pair.shortLeg, delta: 0.22, dte: 24 } }, criteria)).toBe('near_target');
    expect(pmccTargetStatus({ ...pair, shortLeg: { ...pair.shortLeg, delta: 0.18 } }, criteria)).toBe('outside_target');
  });

  it('counts actual listed cycles and stops before the 60-DTE long exit buffer', () => {
    const expirations = [
      '2026-09-17', '2026-10-16', '2026-11-20', '2026-12-18', '2027-01-15',
      '2027-02-19', '2027-03-19', '2027-04-16', '2027-05-21', '2027-06-18',
    ];
    expect(pmccCycleExpirations({
      initialExpiration: pair.shortLeg.expiration,
      longExpiration: pair.longLeg.expiration,
      availableExpirations: expirations,
      shortDteMin: 25,
      shortDteMax: 35,
    })).toEqual([
      '2026-09-17', '2026-10-16', '2026-11-20', '2026-12-18',
      '2027-01-15', '2027-02-19', '2027-03-19', '2027-04-16',
    ]);
  });
});
