import type { AutopilotCandidate } from '@/lib/autopilot/types';
import type { InstrumentMetadata } from '@/lib/instrument-metadata';
import { evaluateInstrumentNormalizationReadiness } from '@/lib/instrument-metadata';
import { LEVERAGE_RISK_MODEL_VERSION } from './types';

export interface LayeredOptionExposure {
  modelVersion: typeof LEVERAGE_RISK_MODEL_VERSION;
  symbol: string;
  economicUnderlying: string | null;
  layeredLeverage: true;
  normalizationAuthoritative: boolean;
  productDeltaExposure: number | null;
  economicUnderlyingDeltaExposure: number | null;
  capitalEfficiency: number | null;
  reasons: string[];
}

/**
 * Gate 6 layered-leverage normalization. Product option Greeks are
 * authoritative; issuer leverage is applied only as a supplemental mapping
 * from product delta exposure to economic-underlying-equivalent sensitivity.
 * No Greek is estimated when the market-data pipeline did not supply it.
 */
export function calculateLayeredOptionExposure(input: {
  candidate: AutopilotCandidate;
  metadata: InstrumentMetadata;
  capitalRequired: number;
}): LayeredOptionExposure {
  const readiness = evaluateInstrumentNormalizationReadiness(input.metadata);
  const economicUnderlying = input.metadata.economicUnderlyingSymbol ?? input.metadata.benchmark ?? null;
  const leverage = input.metadata.signedLeverageMultiplier;
  const optionLegs = input.candidate.legs.filter(leg => leg.assetType === 'option');
  const missingDelta = optionLegs.some(leg => !Number.isFinite(leg.delta ?? NaN));
  const valid = readiness.authoritative
    && economicUnderlying != null
    && Number.isFinite(leverage ?? NaN)
    && leverage !== 0
    && optionLegs.length > 0
    && !missingDelta;

  if (!valid) {
    return {
      modelVersion: LEVERAGE_RISK_MODEL_VERSION,
      symbol: input.candidate.symbol,
      economicUnderlying,
      layeredLeverage: true,
      normalizationAuthoritative: false,
      productDeltaExposure: null,
      economicUnderlyingDeltaExposure: null,
      capitalEfficiency: null,
      reasons: [
        ...readiness.missingCriticalFields,
        ...(missingDelta ? ['Authoritative layered option exposure requires delta for every option leg; missing Greeks are not estimated.'] : []),
        'Layered leverage remains fail-closed until complete product-level option sensitivity is available.',
      ],
    };
  }

  const productDeltaExposure = optionLegs.reduce((sum, leg) => {
    const direction = leg.direction === 'long' ? 1 : -1;
    const multiplier = leg.contractMultiplier ?? 100;
    return sum + direction * (leg.delta as number) * leg.quantity * multiplier * input.candidate.underlyingPrice;
  }, 0);
  const economicUnderlyingDeltaExposure = productDeltaExposure * (leverage as number);
  const capital = Math.abs(input.capitalRequired);

  return {
    modelVersion: LEVERAGE_RISK_MODEL_VERSION,
    symbol: input.candidate.symbol,
    economicUnderlying,
    layeredLeverage: true,
    normalizationAuthoritative: true,
    productDeltaExposure,
    economicUnderlyingDeltaExposure,
    capitalEfficiency: capital > 0 ? Math.abs(economicUnderlyingDeltaExposure) / capital : null,
    reasons: [
      'Product-level option delta is authoritative for the option position.',
      'Economic-underlying delta exposure is supplemental first-order sensitivity: product delta exposure multiplied by validated issuer leverage.',
      'Delta exposure is not maximum loss and does not replace scenario analysis for material layered-leverage decisions.',
    ],
  };
}
