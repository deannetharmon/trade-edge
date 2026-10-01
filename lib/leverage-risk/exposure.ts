import { evaluateInstrumentNormalizationReadiness } from '@/lib/instrument-metadata';
import type {
  EconomicExposureAggregate,
  EconomicExposurePosition,
  LongInstrumentExposure,
  LongInstrumentExposureInput,
  LongInstrumentStressResult,
  UnderlyingStressScenario,
} from './types';
import { LEVERAGE_RISK_MODEL_VERSION } from './types';

export function calculateLongInstrumentExposure(
  input: LongInstrumentExposureInput,
): LongInstrumentExposure {
  const readiness = evaluateInstrumentNormalizationReadiness(input.metadata);
  const capitalDeployed = Math.abs(input.marketValue);
  const capitalRequired = Math.abs(input.capitalRequired ?? input.marketValue);
  const ordinaryMultiplier =
    input.metadata.classification === 'COMMON_STOCK' ? 1 : null;
  const multiplier = input.metadata.signedLeverageMultiplier ?? ordinaryMultiplier;
  const economicUnderlying =
    input.metadata.economicUnderlyingSymbol ?? input.metadata.benchmark ?? null;

  const canNormalize =
    readiness.authoritative
    && multiplier != null
    && Number.isFinite(multiplier)
    && economicUnderlying != null;

  const initialUnderlyingEquivalentExposure = canNormalize
    ? input.marketValue * multiplier
    : null;

  return {
    modelVersion: LEVERAGE_RISK_MODEL_VERSION,
    symbol: input.metadata.symbol,
    economicUnderlying,
    capitalDeployed,
    capitalRequired,
    initialUnderlyingEquivalentExposure,
    capitalEfficiency:
      initialUnderlyingEquivalentExposure != null && capitalRequired > 0
        ? Math.abs(initialUnderlyingEquivalentExposure) / capitalRequired
        : null,
    maxCapitalLoss: capitalDeployed,
    normalizationAuthoritative: canNormalize,
    reasons: canNormalize
      ? ['Initial underlying-equivalent exposure is a first-order sizing approximation.']
      : [
          ...readiness.missingCriticalFields,
          'Authoritative initial exposure requires complete instrument normalization.',
        ],
  };
}

export function stressLongInstrument(
  input: LongInstrumentExposureInput,
  scenario: UnderlyingStressScenario,
): LongInstrumentStressResult {
  const exposure = calculateLongInstrumentExposure(input);
  if (!exposure.normalizationAuthoritative || exposure.initialUnderlyingEquivalentExposure == null) {
    return {
      modelVersion: LEVERAGE_RISK_MODEL_VERSION,
      underlyingMovePct: scenario.underlyingMovePct,
      estimatedInstrumentMovePct: null,
      estimatedPnl: null,
      estimatedLoss: null,
      approximation: true,
      normalizationAuthoritative: false,
      reasons: ['Stress approximation unavailable because normalized exposure is incomplete.'],
    };
  }

  const multiplier =
    input.metadata.signedLeverageMultiplier
    ?? (input.metadata.classification === 'COMMON_STOCK' ? 1 : 0);
  const estimatedInstrumentMovePct = scenario.underlyingMovePct * multiplier;
  const estimatedPnl = input.marketValue * (estimatedInstrumentMovePct / 100);

  return {
    modelVersion: LEVERAGE_RISK_MODEL_VERSION,
    underlyingMovePct: scenario.underlyingMovePct,
    estimatedInstrumentMovePct,
    estimatedPnl,
    estimatedLoss: Math.max(0, -estimatedPnl),
    approximation: true,
    normalizationAuthoritative: true,
    reasons: [
      'Simple multiplier stress is a first-order approximation only; it does not model multi-day reset/path effects.',
    ],
  };
}

export function aggregateEconomicExposure(
  positions: EconomicExposurePosition[],
): EconomicExposureAggregate[] {
  const groups = new Map<string, EconomicExposureAggregate>();
  for (const position of positions) {
    const key = position.economicUnderlying.toUpperCase();
    const current = groups.get(key) ?? {
      economicUnderlying: key,
      grossBullishExposure: 0,
      grossBearishExposure: 0,
      grossExposure: 0,
      netDirectionalExposure: 0,
      capitalDeployed: 0,
    };
    if (position.signedExposure >= 0) current.grossBullishExposure += position.signedExposure;
    else current.grossBearishExposure += Math.abs(position.signedExposure);
    current.grossExposure += Math.abs(position.signedExposure);
    current.netDirectionalExposure += position.signedExposure;
    current.capitalDeployed += Math.abs(position.capitalDeployed);
    groups.set(key, current);
  }
  return Array.from(groups.values());
}
