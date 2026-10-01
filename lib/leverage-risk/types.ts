import type { InstrumentMetadata } from '@/lib/instrument-metadata';

export const LEVERAGE_RISK_MODEL_VERSION = 'lev-risk-v1' as const;

export interface LongInstrumentExposureInput {
  metadata: InstrumentMetadata;
  marketValue: number;
  capitalRequired?: number;
}

export interface LongInstrumentExposure {
  modelVersion: typeof LEVERAGE_RISK_MODEL_VERSION;
  symbol: string;
  economicUnderlying: string | null;
  capitalDeployed: number;
  capitalRequired: number;
  initialUnderlyingEquivalentExposure: number | null;
  capitalEfficiency: number | null;
  authoritative: boolean;
  reasons: string[];
}

export interface UnderlyingStressScenario {
  underlyingMovePct: number;
}

export interface LongInstrumentStressResult {
  modelVersion: typeof LEVERAGE_RISK_MODEL_VERSION;
  underlyingMovePct: number;
  estimatedInstrumentMovePct: number | null;
  estimatedPnl: number | null;
  estimatedLoss: number | null;
  approximation: true;
  authoritative: boolean;
  reasons: string[];
}

export interface EconomicExposurePosition {
  economicUnderlying: string;
  signedExposure: number;
  capitalDeployed: number;
}

export interface EconomicExposureAggregate {
  economicUnderlying: string;
  grossBullishExposure: number;
  grossBearishExposure: number;
  grossExposure: number;
  netDirectionalExposure: number;
  capitalDeployed: number;
}
