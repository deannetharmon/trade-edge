// lib/ai-policy/__tests__/builders/leverageContext.test.ts

import { describe, expect, it } from 'vitest';
import { LEVERAGE_AI_CONTEXT_VERSION, resolveCandidateLeverageAiContext } from '../../builders/attested/leverageContext';

describe('LEV-0001 Gate 9 leverage AI context', () => {
  it('projects only canonical issuer-validated leverage metadata', () => {
    expect(resolveCandidateLeverageAiContext('nvdu')).toEqual({
      leverageContextVersion: LEVERAGE_AI_CONTEXT_VERSION,
      instrumentClassification: 'LEVERAGED_SINGLE_STOCK_ETF_ETP',
      economicUnderlying: 'NVDA',
      signedLeverageMultiplier: 2,
      resetFrequency: 'DAILY',
      metadataConfidence: 'COMPLETE',
      leverageMetadataComplete: true,
      pathRiskState: 'DAILY_RESET_PATH_DEPENDENT',
      tradeRiskNormalizationState: 'NOT_PROVIDED_BY_SCAN_SNAPSHOT',
      metadataCatalogVersion: 'direxion-gate1-2026-10-01',
    });
  });

  it('preserves inverse direction', () => {
    expect(resolveCandidateLeverageAiContext('NVDD')?.signedLeverageMultiplier).toBe(-1);
  });

  it('returns null instead of inferring leverage for an unknown symbol', () => {
    expect(resolveCandidateLeverageAiContext('NVDA')).toBeNull();
    expect(resolveCandidateLeverageAiContext('FAKE3X')).toBeNull();
  });
});
