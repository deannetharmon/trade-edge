import type { InstrumentMetadata } from './types';

const LEVERAGED_CLASSIFICATIONS = new Set<InstrumentMetadata['classification']>([
  'LEVERAGED_ETF_ETP',
  'INVERSE_ETF_ETP',
  'LEVERAGED_INVERSE_ETF_ETP',
  'LEVERAGED_SINGLE_STOCK_ETF_ETP',
  'OTHER_LEVERAGED_PRODUCT',
]);

export interface InstrumentNormalizationReadiness {
  authoritative: boolean;
  missingCriticalFields: string[];
}

export function isLeveragedOrInverseInstrument(metadata: InstrumentMetadata): boolean {
  return LEVERAGED_CLASSIFICATIONS.has(metadata.classification);
}

export function evaluateInstrumentNormalizationReadiness(
  metadata: InstrumentMetadata,
): InstrumentNormalizationReadiness {
  if (!isLeveragedOrInverseInstrument(metadata)) {
    return {
      authoritative: metadata.classification !== 'UNKNOWN' && metadata.confidence !== 'INCOMPLETE',
      missingCriticalFields: metadata.classification === 'UNKNOWN' ? ['classification'] : [],
    };
  }

  const missingCriticalFields: string[] = [];

  if (!metadata.economicUnderlyingSymbol && !metadata.benchmark) {
    missingCriticalFields.push('economicUnderlyingOrBenchmark');
  }

  if (
    !Number.isFinite(metadata.signedLeverageMultiplier)
    || metadata.signedLeverageMultiplier === 0
  ) {
    missingCriticalFields.push('signedLeverageMultiplier');
  }

  if (metadata.resetFrequency === 'UNKNOWN') {
    missingCriticalFields.push('resetFrequency');
  }

  return {
    authoritative:
      missingCriticalFields.length === 0
      && metadata.confidence === 'COMPLETE',
    missingCriticalFields,
  };
}
