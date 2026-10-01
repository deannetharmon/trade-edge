import { describe, expect, it } from 'vitest';
import type { InstrumentMetadata } from '@/lib/instrument-metadata';
import { calculateLongInstrumentExposure, stressLongInstrument } from '../exposure';
import { evaluateLeverageRiskGates } from '../riskGates';

function leveraged(multiplier: number): InstrumentMetadata {
  return {
    symbol: 'TEST',
    classification: multiplier < 0 ? 'LEVERAGED_INVERSE_ETF_ETP' : 'LEVERAGED_ETF_ETP',
    benchmark: 'BENCH',
    signedLeverageMultiplier: multiplier,
    resetFrequency: 'DAILY',
    confidence: 'COMPLETE',
    confidenceReasons: [],
    provenance: { provider: 'fixture', asOf: '2026-10-01T00:00:00.000Z' },
  };
}

describe('LEV-0001 multiplier and denominator boundaries', () => {
  it.each([
    [1.5, 15_000],
    [2, 20_000],
    [3, 30_000],
    [-1, -10_000],
    [-2, -20_000],
    [-3, -30_000],
  ])('maps %sx leverage to signed initial UEE', (multiplier, expected) => {
    expect(calculateLongInstrumentExposure({
      metadata: leveraged(multiplier),
      marketValue: 10_000,
    }).initialUnderlyingEquivalentExposure).toBe(expected);
  });

  it('keeps an ordinary 1x stock at 1x exposure without leverage metadata', () => {
    const metadata: InstrumentMetadata = {
      symbol: 'NVDA',
      classification: 'COMMON_STOCK',
      economicUnderlyingSymbol: 'NVDA',
      resetFrequency: 'NOT_APPLICABLE',
      confidence: 'COMPLETE',
      confidenceReasons: [],
      provenance: { provider: 'broker', asOf: '2026-10-01T00:00:00.000Z' },
    };
    expect(calculateLongInstrumentExposure({ metadata, marketValue: 10_000 })).toMatchObject({
      initialUnderlyingEquivalentExposure: 10_000,
      capitalEfficiency: 1,
      maxCapitalLoss: 10_000,
      normalizationAuthoritative: true,
    });
  });

  it('keeps stress explicitly approximate even with authoritative normalization', () => {
    expect(stressLongInstrument(
      { metadata: leveraged(3), marketValue: 10_000 },
      { underlyingMovePct: -5 },
    )).toMatchObject({
      estimatedInstrumentMovePct: -15,
      approximation: true,
      normalizationAuthoritative: true,
    });
  });

  it.each([0, -1, Number.NaN])('fails all percentage gates closed for invalid portfolio value %s', portfolioValue => {
    const gates = evaluateLeverageRiskGates({
      portfolioValue,
      positionStressLoss: 1_000,
      underlyingExposure: {
        economicUnderlying: 'BENCH',
        grossBullishExposure: 10_000,
        grossBearishExposure: 0,
        grossExposure: 10_000,
        netDirectionalExposure: 10_000,
        capitalDeployed: 10_000,
      },
      policy: {
        maxPositionStressLossPctPortfolio: 5,
        maxUnderlyingGrossExposurePctPortfolio: 50,
        maxUnderlyingNetExposurePctPortfolio: 30,
      },
    });
    expect(gates.every(g => !g.passed && g.actualPct === null)).toBe(true);
  });
});
