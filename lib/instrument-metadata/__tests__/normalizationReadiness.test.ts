import {
  evaluateInstrumentNormalizationReadiness,
  isLeveragedOrInverseInstrument,
  type InstrumentMetadata,
} from '..';

function metadata(overrides: Partial<InstrumentMetadata> = {}): InstrumentMetadata {
  return {
    symbol: 'NVDU',
    classification: 'LEVERAGED_SINGLE_STOCK_ETF_ETP',
    economicUnderlyingSymbol: 'NVDA',
    signedLeverageMultiplier: 2,
    resetFrequency: 'DAILY',
    confidence: 'COMPLETE',
    confidenceReasons: [],
    provenance: { provider: 'fixture', asOf: '2026-10-01T00:00:00.000Z' },
    ...overrides,
  };
}

describe('instrument normalization readiness', () => {
  it('accepts complete validated leveraged metadata', () => {
    const value = metadata();
    expect(isLeveragedOrInverseInstrument(value)).toBe(true);
    expect(evaluateInstrumentNormalizationReadiness(value)).toEqual({
      authoritative: true,
      missingCriticalFields: [],
    });
  });

  it.each([
    [{ economicUnderlyingSymbol: undefined, benchmark: undefined }, 'economicUnderlyingOrBenchmark'],
    [{ signedLeverageMultiplier: undefined }, 'signedLeverageMultiplier'],
    [{ signedLeverageMultiplier: 0 }, 'signedLeverageMultiplier'],
    [{ resetFrequency: 'UNKNOWN' as const }, 'resetFrequency'],
  ])('fails closed when critical leveraged metadata is missing', (overrides, missing) => {
    const result = evaluateInstrumentNormalizationReadiness(metadata(overrides));
    expect(result.authoritative).toBe(false);
    expect(result.missingCriticalFields).toContain(missing);
  });

  it('does not promote partial metadata to authoritative', () => {
    const result = evaluateInstrumentNormalizationReadiness(metadata({ confidence: 'PARTIAL' }));
    expect(result.authoritative).toBe(false);
    expect(result.missingCriticalFields).toEqual([]);
  });

  it('treats an unknown classification as non-authoritative', () => {
    const result = evaluateInstrumentNormalizationReadiness(metadata({
      classification: 'UNKNOWN',
      resetFrequency: 'UNKNOWN',
      confidence: 'INCOMPLETE',
    }));
    expect(result.authoritative).toBe(false);
    expect(result.missingCriticalFields).toContain('classification');
  });

  it('accepts a validated ordinary stock without leverage fields', () => {
    const result = evaluateInstrumentNormalizationReadiness(metadata({
      symbol: 'NVDA',
      classification: 'COMMON_STOCK',
      economicUnderlyingSymbol: 'NVDA',
      signedLeverageMultiplier: undefined,
      resetFrequency: 'NOT_APPLICABLE',
    }));
    expect(result).toEqual({ authoritative: true, missingCriticalFields: [] });
  });
});
