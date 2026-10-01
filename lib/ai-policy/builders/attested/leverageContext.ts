// lib/ai-policy/builders/attested/leverageContext.ts
//
// LEV-0001 Gate 9: server-derived leverage metadata for AI-policy scan snapshots.
// Never trusts client-supplied leverage fields and never infers leverage from ticker spelling.

import {
  DIREXION_GATE1_BOOTSTRAP,
  evaluateInstrumentNormalizationReadiness,
  resolveCatalogInstrumentMetadata,
} from '@/lib/instrument-metadata';

export const LEVERAGE_AI_CONTEXT_VERSION = 'lev-ai-v1';

export interface CandidateLeverageAiContext {
  leverageContextVersion: typeof LEVERAGE_AI_CONTEXT_VERSION;
  instrumentClassification: string;
  economicUnderlying: string;
  signedLeverageMultiplier: number;
  resetFrequency: string;
  metadataConfidence: string;
  leverageMetadataComplete: boolean;
  pathRiskState: 'DAILY_RESET_PATH_DEPENDENT' | 'RESET_PATH_DEPENDENT';
  tradeRiskNormalizationState: 'NOT_PROVIDED_BY_SCAN_SNAPSHOT';
  metadataCatalogVersion: string;
}

/**
 * Returns context only for products present in the canonical issuer-validated
 * leveraged-product catalog. Unknown symbols return null; callers must not
 * infer leverage from ticker naming.
 */
export function resolveCandidateLeverageAiContext(rawSymbol: string): CandidateLeverageAiContext | null {
  const metadata = resolveCatalogInstrumentMetadata(DIREXION_GATE1_BOOTSTRAP, rawSymbol);
  if (!metadata) return null;

  const readiness = evaluateInstrumentNormalizationReadiness(metadata);
  const economicUnderlying = metadata.economicUnderlyingSymbol ?? metadata.benchmark;
  if (!economicUnderlying || !Number.isFinite(metadata.signedLeverageMultiplier)) return null;

  return {
    leverageContextVersion: LEVERAGE_AI_CONTEXT_VERSION,
    instrumentClassification: metadata.classification,
    economicUnderlying,
    signedLeverageMultiplier: metadata.signedLeverageMultiplier as number,
    resetFrequency: metadata.resetFrequency,
    metadataConfidence: metadata.confidence,
    leverageMetadataComplete: readiness.authoritative,
    pathRiskState: metadata.resetFrequency === 'DAILY'
      ? 'DAILY_RESET_PATH_DEPENDENT'
      : 'RESET_PATH_DEPENDENT',
    tradeRiskNormalizationState: 'NOT_PROVIDED_BY_SCAN_SNAPSHOT',
    metadataCatalogVersion: DIREXION_GATE1_BOOTSTRAP.catalogVersion,
  };
}
