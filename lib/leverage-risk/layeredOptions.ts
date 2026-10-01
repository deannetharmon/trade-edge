import type { AutopilotCandidate } from '@/lib/autopilot/types';
import type { InstrumentMetadata } from '@/lib/instrument-metadata';
import { evaluateInstrumentNormalizationReadiness } from '@/lib/instrument-metadata';
import { LEVERAGE_RISK_MODEL_VERSION } from './types';

export interface LayeredOptionStressResult {
  underlyingMovePct: number;
  estimatedProductMovePct: number;
  estimatedPnl: number;
  estimatedLoss: number;
  approximation: true;
}

export interface LayeredOptionExposure {
  modelVersion: typeof LEVERAGE_RISK_MODEL_VERSION;
  symbol: string;
  economicUnderlying: string | null;
  layeredLeverage: true;
  normalizationAuthoritative: boolean;
  productDeltaExposure: number | null;
  economicUnderlyingDeltaExposure: number | null;
  capitalEfficiency: number | null;
  stressScenarios: LayeredOptionStressResult[];
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
      stressScenarios: [],
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
  // Scenario P/L uses the option position's actual product delta exposure as
  // the local sensitivity anchor. The issuer multiplier maps an economic-
  // underlying move to the leveraged product move. This remains explicitly
  // first-order: gamma/volatility/path effects require richer market inputs.
  const stressScenarios = [-20, -15, -10, -5, 5, 10, 15, 20].map(underlyingMovePct => {
    const estimatedProductMovePct = underlyingMovePct * (leverage as number);
    const estimatedPnl = productDeltaExposure * (estimatedProductMovePct / 100);
    return { underlyingMovePct, estimatedProductMovePct, estimatedPnl, estimatedLoss: Math.max(0, -estimatedPnl), approximation: true as const };
  });

  return {
    modelVersion: LEVERAGE_RISK_MODEL_VERSION,
    symbol: input.candidate.symbol,
    economicUnderlying,
    layeredLeverage: true,
    normalizationAuthoritative: true,
    productDeltaExposure,
    economicUnderlyingDeltaExposure,
    capitalEfficiency: capital > 0 ? Math.abs(economicUnderlyingDeltaExposure) / capital : null,
    stressScenarios,
    reasons: [
      'Product-level option delta is authoritative for the option position.',
      'Economic-underlying delta exposure is supplemental first-order sensitivity: product delta exposure multiplied by validated issuer leverage.',
      'Stress scenarios are first-order delta approximations; they do not model gamma, volatility repricing, multi-day reset/path effects, or replace theoretical maximum loss.',
    ],
  };
}
