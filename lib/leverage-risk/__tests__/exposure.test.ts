import { describe, expect, it } from 'vitest';
import type { InstrumentMetadata } from '@/lib/instrument-metadata';
import {
  aggregateEconomicExposure,
  calculateLongInstrumentExposure,
  stressLongInstrument,
} from '../exposure';

const base = (overrides: Partial<InstrumentMetadata> = {}): InstrumentMetadata => ({
  symbol: 'NVDU',
  classification: 'LEVERAGED_SINGLE_STOCK_ETF_ETP',
  economicUnderlyingSymbol: 'NVDA',
  signedLeverageMultiplier: 2,
  resetFrequency: 'DAILY',
  confidence: 'COMPLETE',
  confidenceReasons: [],
  provenance: { provider: 'fixture', asOf: '2026-10-01T00:00:00.000Z' },
  ...overrides,
});

describe('LEV-0001 exposure foundation', () => {
  it('separates capital deployed from +2x initial underlying-equivalent exposure', () => {
    expect(calculateLongInstrumentExposure({ metadata: base(), marketValue: 8_000 })).toMatchObject({
      capitalDeployed: 8_000,
      capitalRequired: 8_000,
      initialUnderlyingEquivalentExposure: 16_000,
      capitalEfficiency: 2,
      maxCapitalLoss: 8_000,
      normalizationAuthoritative: true,
    });
  });

  it('preserves inverse sign', () => {
    expect(calculateLongInstrumentExposure({
      metadata: base({ symbol: 'NVDD', classification: 'INVERSE_ETF_ETP', signedLeverageMultiplier: -1 }),
      marketValue: 8_000,
    }).initialUnderlyingEquivalentExposure).toBe(-8_000);
  });

  it('fails closed when leveraged normalization is incomplete', () => {
    expect(calculateLongInstrumentExposure({
      metadata: base({ signedLeverageMultiplier: undefined, confidence: 'PARTIAL' }),
      marketValue: 8_000,
    })).toMatchObject({ initialUnderlyingEquivalentExposure: null, normalizationAuthoritative: false });
  });

  it('labels simple underlying stress as an approximation', () => {
    expect(stressLongInstrument(
      { metadata: base(), marketValue: 8_000 },
      { underlyingMovePct: -10 },
    )).toMatchObject({
      estimatedInstrumentMovePct: -20,
      estimatedPnl: -1_600,
      estimatedLoss: 1_600,
      approximation: true,
      normalizationAuthoritative: true,
    });
  });

  it('keeps gross exposure visible when bullish and bearish positions offset', () => {
    expect(aggregateEconomicExposure([
      { economicUnderlying: 'NVDA', signedExposure: 100_000, capitalDeployed: 50_000 },
      { economicUnderlying: 'NVDA', signedExposure: -80_000, capitalDeployed: 80_000 },
    ])).toEqual([{
      economicUnderlying: 'NVDA',
      grossBullishExposure: 100_000,
      grossBearishExposure: 80_000,
      grossExposure: 180_000,
      netDirectionalExposure: 20_000,
      capitalDeployed: 130_000,
    }]);
  });
});
