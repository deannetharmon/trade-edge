import { describe, expect, it } from 'vitest';
import type { ScreenResult, SpreadCandidate } from '@/lib/scans/types';
import { screenResultsToAutopilotCandidates } from '../screenerCandidateAdapter';
import { buildPmccFinancialsFromQuotes } from '@/lib/scans/financials';

function checks(): ScreenResult['checks'] {
  const pass = { status: 'pass' as const, value: 'ok', reason: 'ok' };
  return {
    ivr: pass,
    earnings: pass,
    oi: pass,
    delta: pass,
    credit: pass,
    roc: pass,
    pop: pass,
    iv: pass,
    emClearance: pass,
  };
}

function pmccCandidate(overrides: Partial<SpreadCandidate> = {}): SpreadCandidate {
  return {
    strategy: 'PMCC',
    expiration: '2026-09-18',
    dte: 55,
    shortStrike: 205,
    longStrike: 150,
    shortDelta: 0.25,
    longDelta: 0.8,
    credit: 1.35,
    longCost: 31.35,
    netDebit: 30,
    netDebitUnit: 'per_share',
    spreadWidth: 55,
    creditRatio: 1.35 / 31.35,
    roc: 4.5,
    pop: 75,
    shortOI: 900,
    longOI: 1_200,
    capitalRequired: 3_000,
    contractMultiplier: 100,
    quantity: 1,
    longExpiration: '2027-01-15',
    longDte: 174,
    longOccSymbolPMCC: 'AAPL270115C00150000',
    shortOccSymbolPMCC: 'AAPL260918C00205000',
    ...overrides,
  };
}

function result(strategy: string, candidate: SpreadCandidate): ScreenResult {
  return {
    sourceResultId: `source-${strategy}-AAPL`,
    symbol: 'AAPL',
    strategy,
    price: 190,
    ivr: 45,
    qualified: true,
    bestCandidate: candidate,
    failReasons: [],
    checks: checks(),
  };
}

describe('screenerCandidateAdapter PMCC contract', () => {
  it('preserves both call legs, expirations, identities, OI, multiplier, and per-share debit', () => {
    const adapted = screenResultsToAutopilotCandidates([result('PMCC', pmccCandidate())]);

    expect(adapted.skipped).toEqual([]);
    expect(adapted.candidates).toHaveLength(1);
    const candidate = adapted.candidates[0];
    expect(candidate.strategy).toBe('PMCC');
    expect(candidate.netDebit).toBe(30);
    expect(candidate.netDebitUnit).toBe('per_share');
    expect(candidate.theoreticalMaxLoss).toBe(3_000);
    expect(candidate.sourceResultId).toBe('source-PMCC-AAPL');
    expect(candidate.legs).toEqual([
      expect.objectContaining({
        direction: 'long',
        optionType: 'call',
        strike: 150,
        expiration: '2027-01-15',
        quantity: 1,
        contractMultiplier: 100,
        openInterest: 1_200,
        optionSymbol: 'AAPL270115C00150000',
      }),
      expect.objectContaining({
        direction: 'short',
        optionType: 'call',
        strike: 205,
        expiration: '2026-09-18',
        quantity: 1,
        contractMultiplier: 100,
        openInterest: 900,
        optionSymbol: 'AAPL260918C00205000',
      }),
    ]);
  });

  it('calculates total net debit exactly once for quantity and multiplier', () => {
    const standard = screenResultsToAutopilotCandidates([result('PMCC', pmccCandidate())], 2);
    expect(standard.candidates[0].theoreticalMaxLoss).toBe(6_000);

    const nonstandard = screenResultsToAutopilotCandidates([
      result('PMCC', pmccCandidate({
        ...buildPmccFinancialsFromQuotes({
          longCostPerShare: 31.35,
          shortCreditPerShare: 1.35,
          contractMultiplier: 10,
          quantity: 1,
        }),
      })),
    ], 3);
    expect(nonstandard.candidates[0].theoreticalMaxLoss).toBe(900);
    expect(nonstandard.candidates[0].legs.every((leg) => leg.contractMultiplier === 10)).toBe(true);
  });

  it.each([
    ['missing debit', { netDebit: undefined }],
    ['nonpositive debit', { netDebit: 0, capitalRequired: 0 }],
    ['missing unit', { netDebitUnit: undefined }],
    ['missing multiplier', { contractMultiplier: undefined }],
    ['same expiration', { longExpiration: '2026-09-18' }],
    ['reversed strikes', { longStrike: 210 }],
    ['missing long identity', { longOccSymbolPMCC: undefined }],
  ])('explicitly skips invalid PMCC: %s', (_label, overrides) => {
    const adapted = screenResultsToAutopilotCandidates([
      result('PMCC', pmccCandidate(overrides)),
    ]);
    expect(adapted.candidates).toEqual([]);
    expect(adapted.skipped[0].reason).toMatch(/Invalid PMCC/);
  });

  it('excludes Covered Call before submission with an explicit reason', () => {
    const adapted = screenResultsToAutopilotCandidates([
      result('CC', pmccCandidate({ strategy: 'CC' })),
    ]);
    expect(adapted.candidates).toEqual([]);
    expect(adapted.skipped).toEqual([
      expect.objectContaining({ strategy: 'CC', reason: 'Unsupported strategy "CC".' }),
    ]);
  });
});
