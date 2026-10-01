import { describe, expect, it } from 'vitest';
import { calculateLayeredOptionExposure } from '../layeredOptions';
import type { AutopilotCandidate } from '@/lib/autopilot/types';
import type { InstrumentMetadata } from '@/lib/instrument-metadata';

const metadata: InstrumentMetadata = {
  symbol: 'NVDU', classification: 'LEVERAGED_SINGLE_STOCK_ETF_ETP',
  economicUnderlyingSymbol: 'NVDA', signedLeverageMultiplier: 2,
  resetFrequency: 'DAILY', confidence: 'COMPLETE', confidenceReasons: [],
  provenance: { provider: 'Direxion', asOf: '2026-10-01T00:00:00.000Z' },
};

function candidate(deltas: Array<number | undefined>): AutopilotCandidate {
  return {
    id: 'n', strategy: 'BPS', symbol: 'NVDU', underlyingPrice: 100,
    estimatedCredit: 1, theoreticalMaxLoss: 400,
    legs: deltas.map((delta, i) => ({
      symbol: 'NVDU', underlyingSymbol: 'NVDU', assetType: 'option' as const,
      direction: i === 0 ? 'short' as const : 'long' as const,
      optionType: 'put' as const, strike: i === 0 ? 95 : 90,
      quantity: 1, contractMultiplier: 100, delta,
    })),
  };
}

describe('LEV-0001 Gate 6 layered option exposure', () => {
  it('fails closed when any option leg delta is missing', () => {
    const result = calculateLayeredOptionExposure({ candidate: candidate([-0.25, undefined]), metadata, capitalRequired: 400 });
    expect(result.normalizationAuthoritative).toBe(false);
    expect(result.economicUnderlyingDeltaExposure).toBeNull();
    expect(result.reasons.join(' ')).toMatch(/missing Greeks are not estimated/i);
  });

  it('uses actual signed product deltas and keeps issuer leverage supplemental', () => {
    const result = calculateLayeredOptionExposure({ candidate: candidate([-0.25, -0.10]), metadata, capitalRequired: 400 });
    // short put: +2500 product delta dollars; long put: -1000 => +1500.
    expect(result.productDeltaExposure).toBeCloseTo(1500);
    expect(result.economicUnderlyingDeltaExposure).toBeCloseTo(3000);
    expect(result.capitalEfficiency).toBeCloseTo(7.5);
    expect(result.normalizationAuthoritative).toBe(true);
  });
});
