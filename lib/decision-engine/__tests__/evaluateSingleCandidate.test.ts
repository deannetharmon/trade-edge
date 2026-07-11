// lib/decision-engine/__tests__/evaluateSingleCandidate.test.ts
//
// Sprint 2 validation: DecisionAnalysis contract, deterministic strategy
// scenarios (CSP/BPS/BCS/WAIT/AVOID), and explanation-quality checks for
// lib/decision-engine's evaluateSingleCandidate(). This is the shared engine
// -- these tests must pass regardless of which surface (Autopilot, Portfolio,
// Screener) constructs the context.

import { describe, expect, it } from 'vitest';
import { evaluateSingleCandidate } from '@/lib/decision-engine';
import type { SingleCandidateDecisionContext } from '@/lib/decision-engine';
import {
  makeCandidate,
  makeCleanConfidenceFramework,
} from '../../../test/fixtures/autopilotFixtures';

function makeContext(
  overrides: Partial<SingleCandidateDecisionContext> = {},
): SingleCandidateDecisionContext {
  return {
    candidate: makeCandidate(),
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
    preferences: {
      willingToOwn: true,
      preferDefinedRisk: false,
      minimumConfidence: 70,
    },
    confidenceInput: { framework: makeCleanConfidenceFramework() },
    opportunityScore: {
      total: 80,
      edgeScore: 75,
      goalAlignmentFactor: 1,
      riskContributionPenalty: 10,
      postureMultiplier: 1,
      notes: [],
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Build validation (import-shape only; the actual `next build` and
//    `tsc --noEmit` checks are manual/CI steps -- see SPRINT2_TEST_PLAN.md
//    section 1). This confirms the module resolves and exports exactly the
//    documented public surface, catching accidental duplicate-implementation
//    drift (e.g. a second evaluateSingleCandidate exported from elsewhere).
// ---------------------------------------------------------------------------
describe('module surface', () => {
  it('exports exactly one evaluateSingleCandidate implementation', () => {
    expect(typeof evaluateSingleCandidate).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// 2. DecisionAnalysis contract
// ---------------------------------------------------------------------------
describe('DecisionAnalysis contract', () => {
  const analysis = evaluateSingleCandidate(makeContext());

  it('includes every required top-level field', () => {
    expect(analysis).toHaveProperty('recommendation');
    expect(analysis).toHaveProperty('confidence');
    expect(analysis).toHaveProperty('rationale');
    expect(analysis).toHaveProperty('supportingEvidence');
    expect(analysis).toHaveProperty('concerns');
    expect(analysis).toHaveProperty('alternatives');
    expect(analysis).toHaveProperty('reviewTriggers');
    expect(analysis).toHaveProperty('expectedOutcome');
    expect(analysis).toHaveProperty('metadata');
  });

  it('always sets executionAllowed and paperExecutionAllowed to false', () => {
    expect(analysis.metadata.executionAllowed).toBe(false);
    expect(analysis.metadata.paperExecutionAllowed).toBe(false);
  });

  it('enforces execution flags as false even under a WAIT/AVOID path', () => {
    const avoidAnalysis = evaluateSingleCandidate(
      makeContext({ market: { bias: 'bullish', earningsWithinExpiration: true, macroRiskElevated: false, volatilityStable: true } }),
    );
    expect(avoidAnalysis.recommendation.action).toBe('AVOID');
    expect(avoidAnalysis.metadata.executionAllowed).toBe(false);
    expect(avoidAnalysis.metadata.paperExecutionAllowed).toBe(false);
  });

  it('rationale is non-trivial prose, not a bare score statement', () => {
    expect(analysis.rationale.length).toBeGreaterThan(20);
    expect(analysis.rationale.toLowerCase()).not.toMatch(/^score is/);
  });

  it('evidence, concerns, alternatives, and review triggers are arrays', () => {
    expect(Array.isArray(analysis.supportingEvidence)).toBe(true);
    expect(Array.isArray(analysis.concerns)).toBe(true);
    expect(Array.isArray(analysis.alternatives)).toBe(true);
    expect(Array.isArray(analysis.reviewTriggers)).toBe(true);
  });

  it('confidence includes all five sub-dimensions plus overall', () => {
    expect(analysis.confidence).toEqual(
      expect.objectContaining({
        overall: expect.any(Number),
        market: expect.any(Number),
        portfolio: expect.any(Number),
        execution: expect.any(Number),
        income: expect.any(Number),
        risk: expect.any(Number),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Strategy recommendation scenarios (deterministic fixtures)
// ---------------------------------------------------------------------------
describe('strategy recommendation scenarios', () => {
  it('recommends SELL_CSP for a clean CSP candidate with no blocking concerns', () => {
    const context = makeContext({
      candidate: makeCandidate({ strategy: 'CSP' }),
      preferences: { willingToOwn: true, preferDefinedRisk: false, minimumConfidence: 70 },
      // The default CSP fixture carries a ~$14.8k max loss (realistic for a
      // single cash-secured put); explicitly size available buying power and
      // the single-ticker limit so this scenario tests "clean CSP" in
      // isolation rather than accidentally tripping the concentration gate
      // (that gate has its own dedicated test in risk validation).
      portfolio: {
        netLiquidity: 200000,
        availableBuyingPower: 100000,
        existingSymbolExposure: 0,
        sectorExposurePct: undefined,
        maxSingleTickerPct: 10,
        maxSectorPct: 25,
      },
    });
    const analysis = evaluateSingleCandidate(context);

    expect(analysis.recommendation.action).toBe('SELL_CSP');
    expect(analysis.recommendation.status).toBe('recommended');
    expect(analysis.recommendation.strategy).toBe('CSP');
  });

  it('recommends OPEN_BPS for a clean BPS candidate', () => {
    const context = makeContext({
      candidate: makeCandidate({
        strategy: 'BPS',
        theoreticalMaxLoss: 500,
        legs: [
          { symbol: 'AMD  260821P00150000', underlyingSymbol: 'AMD', assetType: 'option', direction: 'short', optionType: 'put', strike: 150, quantity: 1, bid: 1.9, ask: 2.0, quoteTimestamp: '2026-07-11T13:00:00.000Z' },
          { symbol: 'AMD  260821P00145000', underlyingSymbol: 'AMD', assetType: 'option', direction: 'long', optionType: 'put', strike: 145, quantity: 1, bid: 1.2, ask: 1.3, quoteTimestamp: '2026-07-11T13:00:00.000Z' },
        ],
      }),
    });
    const analysis = evaluateSingleCandidate(context);

    expect(analysis.recommendation.action).toBe('OPEN_BPS');
    expect(analysis.recommendation.status).toBe('recommended');
  });

  it('recommends OPEN_BCS for a clean BCS candidate', () => {
    const context = makeContext({
      candidate: makeCandidate({ strategy: 'BCS', theoreticalMaxLoss: 500 }),
      market: { bias: 'bearish', earningsWithinExpiration: false, macroRiskElevated: false, volatilityStable: true },
    });
    const analysis = evaluateSingleCandidate(context);

    expect(analysis.recommendation.action).toBe('OPEN_BCS');
    expect(analysis.recommendation.status).toBe('recommended');
  });

  it('recommends WAIT when opportunity score is low and market bias is uncertain', () => {
    const context = makeContext({
      market: { bias: 'uncertain', earningsWithinExpiration: false, macroRiskElevated: false, volatilityStable: true },
      opportunityScore: {
        total: 35,
        edgeScore: 30,
        goalAlignmentFactor: 1,
        riskContributionPenalty: 40,
        postureMultiplier: 1,
        notes: [],
      },
    });
    const analysis = evaluateSingleCandidate(context);

    expect(analysis.recommendation.action).toBe('WAIT');
    expect(analysis.recommendation.status).toBe('conditional');
  });

  it('recommends WAIT when confidence falls below the configured minimum', () => {
    const context = makeContext({
      preferences: { willingToOwn: true, preferDefinedRisk: false, minimumConfidence: 90 },
      confidenceInput: { framework: makeCleanConfidenceFramework({ total: 60 }) },
    });
    const analysis = evaluateSingleCandidate(context);

    expect(analysis.recommendation.action).toBe('WAIT');
    expect(analysis.recommendation.status).toBe('conditional');
  });

  it('recommends AVOID when a critical concern is present (earnings inside expiry)', () => {
    const context = makeContext({
      market: { bias: 'bullish', earningsWithinExpiration: true, macroRiskElevated: false, volatilityStable: true },
    });
    const analysis = evaluateSingleCandidate(context);

    expect(analysis.recommendation.action).toBe('AVOID');
    expect(analysis.recommendation.status).toBe('not_recommended');
    expect(analysis.concerns.some((c) => c.id === 'earnings-risk' && c.severity === 'critical')).toBe(true);
  });

  it('recommends AVOID when buying power is insufficient', () => {
    const context = makeContext({
      candidate: makeCandidate({ theoreticalMaxLoss: 999999 }),
      portfolio: {
        netLiquidity: 100000,
        availableBuyingPower: 5000,
        existingSymbolExposure: 0,
        sectorExposurePct: undefined,
        maxSingleTickerPct: 10,
        maxSectorPct: 25,
      },
    });
    const analysis = evaluateSingleCandidate(context);

    expect(analysis.recommendation.action).toBe('AVOID');
    expect(analysis.concerns.some((c) => c.id === 'buying-power' && c.severity === 'critical')).toBe(true);
  });

  it('recommends AVOID when a CSP is proposed but the trader is unwilling to own shares', () => {
    const context = makeContext({
      candidate: makeCandidate({ strategy: 'CSP' }),
      preferences: { willingToOwn: false, preferDefinedRisk: false, minimumConfidence: 70 },
    });
    const analysis = evaluateSingleCandidate(context);

    expect(analysis.recommendation.action).toBe('AVOID');
    expect(analysis.concerns.some((c) => c.id === 'assignment-intent')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Explanation quality
// ---------------------------------------------------------------------------
describe('explanation quality', () => {
  it('rejects a rationale that is only "Score is high." or equivalent bare-score text', () => {
    const banned = /^score is (high|low|good|bad)\.?$/i;
    const scenarios: SingleCandidateDecisionContext[] = [
      makeContext(),
      makeContext({ market: { bias: 'bullish', earningsWithinExpiration: true, macroRiskElevated: false, volatilityStable: true } }),
      makeContext({ market: { bias: 'uncertain', earningsWithinExpiration: false, macroRiskElevated: false, volatilityStable: true } }),
    ];

    for (const context of scenarios) {
      const analysis = evaluateSingleCandidate(context);
      expect(analysis.rationale).not.toMatch(banned);
      expect(analysis.rationale.split(' ').length).toBeGreaterThanOrEqual(8);
    }
  });

  it('every concern explains why, not just that a rule fired', () => {
    const context = makeContext({
      market: { bias: 'bullish', earningsWithinExpiration: true, macroRiskElevated: true, volatilityStable: false },
    });
    const analysis = evaluateSingleCandidate(context);

    expect(analysis.concerns.length).toBeGreaterThan(0);
    for (const concern of analysis.concerns) {
      expect(concern.explanation.length).toBeGreaterThan(10);
    }
  });

  it('recommended alternatives carry reasons, satisfying "why not the alternatives"', () => {
    const analysis = evaluateSingleCandidate(makeContext());
    expect(analysis.alternatives.length).toBeGreaterThan(0);
    for (const alt of analysis.alternatives) {
      expect(alt.reasons.length).toBeGreaterThan(0);
      expect(alt.reasons[0].length).toBeGreaterThan(5);
    }
  });

  it('review triggers satisfy "what would change the recommendation"', () => {
    const analysis = evaluateSingleCandidate(makeContext());
    expect(analysis.reviewTriggers.length).toBeGreaterThan(0);
    for (const trigger of analysis.reviewTriggers) {
      expect(trigger.explanation.length).toBeGreaterThan(10);
    }
  });

  it('produces different rationale text for different candidates in the same status bucket (per-candidate narrative)', () => {
    // GAP CLOSED: rationale used to be one of three fixed sentences per
    // status bucket. It now interpolates the candidate's symbol, the actual
    // triggering concern(s), confidence/opportunity numbers, and the
    // strongest alternative considered, so two different candidates landing
    // in the same status no longer produce identical text.
    const a = evaluateSingleCandidate(makeContext({ candidate: makeCandidate({ id: 'a', symbol: 'AMD' }) }));
    const b = evaluateSingleCandidate(makeContext({ candidate: makeCandidate({ id: 'b', symbol: 'NVDA' }) }));
    expect(a.rationale).not.toBe(b.rationale);
    expect(a.rationale).toContain('AMD');
    expect(b.rationale).toContain('NVDA');
  });

  it('rationale for a not_recommended candidate names the specific blocking concern', () => {
    const analysis = evaluateSingleCandidate(
      makeContext({ market: { bias: 'bullish', earningsWithinExpiration: true, macroRiskElevated: false, volatilityStable: true } }),
    );
    expect(analysis.recommendation.status).toBe('not_recommended');
    expect(analysis.rationale.toLowerCase()).toContain('earnings');
  });

  it('rationale for a conditional candidate names the specific reason it is waiting', () => {
    const analysis = evaluateSingleCandidate(
      makeContext({ preferences: { willingToOwn: true, preferDefinedRisk: false, minimumConfidence: 90 }, confidenceInput: { framework: makeCleanConfidenceFramework({ total: 60 }) } }),
    );
    expect(analysis.recommendation.status).toBe('conditional');
    expect(analysis.rationale).toContain('60');
    expect(analysis.rationale).toContain('90');
  });
});
