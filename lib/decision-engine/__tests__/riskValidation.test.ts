// lib/decision-engine/__tests__/riskValidation.test.ts
//
// Sprint 2 validation, item 4: risk validation. Covers the concern-producing
// gates inside evaluateSingleCandidate() (max-loss/buying-power, ticker
// concentration, sector concentration, earnings) plus missing-metadata
// handling. The Autopilot-layer portfolio pre-gates (drawdown, per-trade
// sizing, correlation) are covered separately in
// lib/autopilot/decision/__tests__/riskGateEngine.test.ts.

import { describe, expect, it } from 'vitest';
import { evaluateSingleCandidate } from '@/lib/decision-engine';
import type { SingleCandidateDecisionContext } from '@/lib/decision-engine';
import { makeCandidate, makeCleanConfidenceFramework } from '../../../test/fixtures/autopilotFixtures';

function baseContext(overrides: Partial<SingleCandidateDecisionContext> = {}): SingleCandidateDecisionContext {
  return {
    candidate: makeCandidate({ theoreticalMaxLoss: 1000 }),
    objective: 'generate_income',
    source: 'manual',
    portfolio: {
      netLiquidity: 100000,
      availableBuyingPower: 50000,
      existingSymbolExposure: 0,
      sectorExposurePct: undefined,
      maxSingleTickerPct: 10,
      maxSectorPct: 25,
    },
    market: {
      bias: 'bullish',
      earningsWithinExpiration: false,
      macroRiskElevated: false,
      volatilityStable: true,
    },
    preferences: { willingToOwn: true, preferDefinedRisk: false, minimumConfidence: 70 },
    confidenceInput: { framework: makeCleanConfidenceFramework() },
    opportunityScore: { total: 80, edgeScore: 75, goalAlignmentFactor: 1, riskContributionPenalty: 10, postureMultiplier: 1, notes: [] },
    ...overrides,
  };
}

describe('max-loss / buying-power gate', () => {
  it('passes when max loss is within buying power', () => {
    const analysis = evaluateSingleCandidate(
      baseContext({ candidate: makeCandidate({ theoreticalMaxLoss: 1000 }) }),
    );
    expect(analysis.concerns.some((c) => c.id === 'buying-power')).toBe(false);
  });

  it('blocks (critical) when max loss exceeds available buying power', () => {
    const analysis = evaluateSingleCandidate(
      baseContext({
        candidate: makeCandidate({ theoreticalMaxLoss: 1000 }),
        portfolio: {
          netLiquidity: 100000,
          availableBuyingPower: 500,
          existingSymbolExposure: 0,
          sectorExposurePct: undefined,
          maxSingleTickerPct: 10,
          maxSectorPct: 25,
        },
      }),
    );
    const concern = analysis.concerns.find((c) => c.id === 'buying-power');
    expect(concern?.severity).toBe('critical');
    expect(analysis.recommendation.action).toBe('AVOID');
  });

  it('treats exactly-equal max loss and buying power as passing (boundary)', () => {
    const analysis = evaluateSingleCandidate(
      baseContext({
        candidate: makeCandidate({ theoreticalMaxLoss: 1000 }),
        portfolio: {
          netLiquidity: 100000,
          availableBuyingPower: 1000,
          existingSymbolExposure: 0,
          sectorExposurePct: undefined,
          maxSingleTickerPct: 50,
          maxSectorPct: 50,
        },
      }),
    );
    expect(analysis.concerns.some((c) => c.id === 'buying-power')).toBe(false);
  });
});

describe('ticker concentration gate', () => {
  it('passes when projected exposure is within the single-ticker limit', () => {
    const analysis = evaluateSingleCandidate(
      baseContext({
        candidate: makeCandidate({ theoreticalMaxLoss: 5000 }),
        portfolio: {
          netLiquidity: 100000,
          availableBuyingPower: 50000,
          existingSymbolExposure: 0,
          sectorExposurePct: undefined,
          maxSingleTickerPct: 10,
          maxSectorPct: 25,
        },
      }),
    );
    expect(analysis.concerns.some((c) => c.id === 'single-ticker-concentration')).toBe(false);
  });

  it('blocks (high) when existing + new exposure exceeds the single-ticker limit', () => {
    const analysis = evaluateSingleCandidate(
      baseContext({
        candidate: makeCandidate({ theoreticalMaxLoss: 5000 }),
        portfolio: {
          netLiquidity: 100000,
          availableBuyingPower: 50000,
          existingSymbolExposure: 6000, // 6000 + 5000 = 11000 > 10% of 100000
          sectorExposurePct: undefined,
          maxSingleTickerPct: 10,
          maxSectorPct: 25,
        },
      }),
    );
    const concern = analysis.concerns.find((c) => c.id === 'single-ticker-concentration');
    expect(concern?.severity).toBe('high');
    expect(analysis.recommendation.action).toBe('WAIT');
  });
});

describe('sector concentration gate', () => {
  it('no-ops when sector exposure is not tracked (undefined)', () => {
    const analysis = evaluateSingleCandidate(
      baseContext({
        portfolio: {
          netLiquidity: 100000,
          availableBuyingPower: 50000,
          existingSymbolExposure: 0,
          sectorExposurePct: undefined,
          maxSingleTickerPct: 10,
          maxSectorPct: 25,
        },
      }),
    );
    expect(analysis.concerns.some((c) => c.id === 'sector-concentration')).toBe(false);
  });

  it('blocks (high) when sector exposure exceeds the configured cap', () => {
    const analysis = evaluateSingleCandidate(
      baseContext({
        portfolio: {
          netLiquidity: 100000,
          availableBuyingPower: 50000,
          existingSymbolExposure: 0,
          sectorExposurePct: 30,
          maxSingleTickerPct: 10,
          maxSectorPct: 25,
        },
      }),
    );
    const concern = analysis.concerns.find((c) => c.id === 'sector-concentration');
    expect(concern?.severity).toBe('high');
  });
});

describe('earnings gate', () => {
  it('passes when earnings fall outside the expiration window', () => {
    const analysis = evaluateSingleCandidate(
      baseContext({ market: { bias: 'bullish', earningsWithinExpiration: false, macroRiskElevated: false, volatilityStable: true } }),
    );
    expect(analysis.concerns.some((c) => c.id === 'earnings-risk')).toBe(false);
  });

  it('blocks (critical) when earnings fall inside the expiration window', () => {
    const analysis = evaluateSingleCandidate(
      baseContext({ market: { bias: 'bullish', earningsWithinExpiration: true, macroRiskElevated: false, volatilityStable: true } }),
    );
    const concern = analysis.concerns.find((c) => c.id === 'earnings-risk');
    expect(concern?.severity).toBe('critical');
    expect(analysis.recommendation.action).toBe('AVOID');
  });
});

describe('missing metadata handling', () => {
  it('does not crash and does not fabricate positive signal when pop/roc/ivr are undefined', () => {
    const analysis = evaluateSingleCandidate(
      baseContext({
        candidate: makeCandidate({ pop: undefined, roc: undefined, ivr: undefined }),
      }),
    );
    expect(analysis.supportingEvidence.some((e) => e.id === 'pop')).toBe(false);
    expect(analysis.supportingEvidence.some((e) => e.id === 'roc')).toBe(false);
    expect(analysis.supportingEvidence.some((e) => e.id === 'ivr')).toBe(false);
    // Core fields are still populated -- missing optional metadata degrades
    // evidence, not the analysis shape.
    expect(analysis.recommendation).toBeDefined();
  });

  it('does not crash when correlationPenalty/concentrationPenalty/sector are undefined', () => {
    const analysis = evaluateSingleCandidate(
      baseContext({
        candidate: makeCandidate({ correlationPenalty: undefined, concentrationPenalty: undefined, sector: undefined }),
      }),
    );
    expect(analysis.recommendation).toBeDefined();
  });

  it('treats an unknown/uncertain market trend as a WAIT signal rather than a neutral default', () => {
    // This mirrors the Autopilot-layer deriveMarketBias() behavior change
    // documented in recommendationEngine.ts: missing trend data must not
    // read as "trend is fine, proceed."
    const analysis = evaluateSingleCandidate(
      baseContext({ market: { bias: 'uncertain', earningsWithinExpiration: false, macroRiskElevated: false, volatilityStable: true } }),
    );
    expect(analysis.recommendation.action).toBe('WAIT');
  });
});
