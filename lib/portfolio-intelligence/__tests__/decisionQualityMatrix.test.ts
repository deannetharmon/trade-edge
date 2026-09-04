// lib/portfolio-intelligence/__tests__/decisionQualityMatrix.test.ts
//
// PI-0008B: Decision Quality V1 regression tests.
//   1. Unit tests on the new scaling helpers (gammaDteFraction/scaleWeight).
//   2. Unit tests on each new scoreCandidates() contribution in isolation
//      (gamma/DTE risk, Remaining Opportunity, scaled earnings proximity).
//   3. The ticket's four validation scenarios, exercised through
//      evaluatePositionObjective() with realistic, hand-constructed evidence
//      -- no symbol-based branching exists anywhere in the engine; SOXL/AMD/
//      NVDA here are just descriptive fixture labels, the exact same way
//      earlier tickets' acceptance scenarios already used real tickers as
//      labels for hand-picked evidence.

import { describe, expect, it } from 'vitest';
import { evaluatePositionObjective } from '@/lib/portfolio-intelligence';
import type { PositionObjectiveInput } from '@/lib/portfolio-intelligence';
import { selectManagementIntent, type ManagementIntentResult } from '../managementIntent';
import { gammaDteFraction, scaleWeight, breakevenPopDampeningFactor, BREAKEVEN_POP_DAMPEN_THRESHOLD_PCT, BREAKEVEN_POP_DAMPEN_FLOOR, DECISION_QUALITY_WEIGHTS as W } from '../decisionQualityMatrix';

const NOW = new Date('2026-07-13T13:00:00.000Z');

function baseInput(overrides: Partial<PositionObjectiveInput> = {}): PositionObjectiveInput {
  return {
    positionId: 'pos_1',
    symbol: 'TEST',
    strategy: 'BPS',
    dte: 30,
    pnlPct: 10,
    buffer: 8,
    hasGtc: true,
    ...overrides,
  };
}

// A recommendation is "internally consistent" when: exactly one candidate is
// flagged as the winner and it matches `intent`; every candidate's recorded
// contributions sum exactly to its score; the winner never also appears in
// `alternatives`; and `margin` is always winnerScore - runnerUpScore.
function expectInternallyConsistent(mi: ManagementIntentResult): void {
  const winners = mi.candidates.filter((c) => c.isWinner);
  expect(winners).toHaveLength(1);
  expect(winners[0].intent).toBe(mi.intent);
  for (const candidate of mi.candidates) {
    const summed = candidate.contributions.reduce((sum, c) => sum + c.points, 0);
    expect(summed).toBe(candidate.score);
  }
  expect(mi.alternatives.some((a) => a.intent === mi.intent)).toBe(false);
  expect(mi.margin).toBe(mi.winnerScore - mi.runnerUpScore);
  // Note: a lone baseline-only Hold Position legitimately has zero reasons
  // (baseline contributions are intentionally excluded from `reasons` --
  // see managementIntent.ts's bump() doc comment), so this helper does not
  // assert reasons.length > 0 universally.
}

// ---------------------------------------------------------------------------
// Scaling helpers
// ---------------------------------------------------------------------------

describe('gammaDteFraction', () => {
  it('is 0 at (or beyond) the management window edge', () => {
    expect(gammaDteFraction(21)).toBe(0);
    expect(gammaDteFraction(30)).toBe(0);
  });

  it('is 1 at or past expiration', () => {
    expect(gammaDteFraction(0)).toBe(1);
    expect(gammaDteFraction(-3)).toBe(1);
  });

  it('increases monotonically as DTE decreases', () => {
    const values = [21, 17, 10, 5, 0].map(gammaDteFraction);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    }
  });
});

describe('scaleWeight', () => {
  it('clamps fractions outside [0, 1] before scaling', () => {
    expect(scaleWeight(-0.5, 24)).toBe(0);
    expect(scaleWeight(1.5, 24)).toBe(24);
  });

  it('rounds to the nearest integer', () => {
    expect(scaleWeight(0.5, 5)).toBe(3); // 2.5 rounds to 3
  });
});

// ---------------------------------------------------------------------------
// POP-0002: breakeven-POP dampening of the gamma/DTE trigger, in isolation.
// Threshold (80%) and floor (0.5) validated against real held positions --
// ORCL (87.1%) and BE (94.3%) dampened, MU (72.4%) correctly not (Ian).
// ---------------------------------------------------------------------------
describe('breakevenPopDampeningFactor', () => {
  it('is 1 (no dampening) at or below the threshold', () => {
    expect(breakevenPopDampeningFactor(BREAKEVEN_POP_DAMPEN_THRESHOLD_PCT)).toBe(1);
    expect(breakevenPopDampeningFactor(50)).toBe(1);
    // MU's real reading (72.4%) -- meaningfully above entry floor (65%) but
    // below the dampening threshold -- must stay fully undampened.
    expect(breakevenPopDampeningFactor(72.4)).toBe(1);
  });

  it('is 1 (no dampening) when POP is null or undefined', () => {
    expect(breakevenPopDampeningFactor(null)).toBe(1);
    expect(breakevenPopDampeningFactor(undefined)).toBe(1);
  });

  it('scales down as POP rises above the threshold', () => {
    // ORCL's real reading (87.1%) and BE's (94.3%) -- both above threshold,
    // both should dampen, BE (higher POP) more than ORCL.
    const orcl = breakevenPopDampeningFactor(87.1);
    const be = breakevenPopDampeningFactor(94.3);
    expect(orcl).toBeLessThan(1);
    expect(be).toBeLessThan(orcl);
  });

  it('reaches exactly the floor at 100% POP, and never goes below it', () => {
    expect(breakevenPopDampeningFactor(100)).toBe(BREAKEVEN_POP_DAMPEN_FLOOR);
    expect(breakevenPopDampeningFactor(150)).toBe(BREAKEVEN_POP_DAMPEN_FLOOR); // out-of-range input still clamps
  });
});

// ---------------------------------------------------------------------------
// Gamma/DTE risk contribution, in isolation
// ---------------------------------------------------------------------------

describe('selectManagementIntent: gamma/DTE risk (new in PI-0008B)', () => {
  it('contributes nothing at or outside the 21-day management window', () => {
    const result = selectManagementIntent({ context: 'other-position', dte: 25 });
    expect(result.intent).toBe('HOLD_POSITION');
    expect(result.winnerScore).toBe(W.holdBaseline);
  });

  it('adds a small, evidence-labeled Reduce Risk contribution inside the window, without overriding Hold on its own', () => {
    const result = selectManagementIntent({ context: 'other-position', dte: 10 });
    // Hold's baseline (10) still exceeds the gamma-only Reduce Risk
    // contribution at 10 DTE -- gamma risk alone is not enough to flip a
    // position with no other evidence at all, by design.
    expect(result.intent).toBe('HOLD_POSITION');
    const reduceRisk = result.candidates.find((c) => c.intent === 'REDUCE_RISK');
    expect(reduceRisk).toBeDefined();
    expect(reduceRisk!.contributions.some((c) => c.id === 'gamma-dte-reduce-risk')).toBe(true);
  });

  it('grows as DTE decreases toward expiration', () => {
    const far = selectManagementIntent({ context: 'other-position', dte: 18 });
    const near = selectManagementIntent({ context: 'other-position', dte: 2 });
    const farReduceRisk = far.candidates.find((c) => c.intent === 'REDUCE_RISK')?.score ?? 0;
    const nearReduceRisk = near.candidates.find((c) => c.intent === 'REDUCE_RISK')?.score ?? 0;
    expect(nearReduceRisk).toBeGreaterThan(farReduceRisk);
  });

  // POP-0002: breakeven-POP dampens this contribution, never zeroes it.
  it('a high breakeven-POP dampens (but does not zero) the gamma/DTE contribution', () => {
    const undamped = selectManagementIntent({ context: 'other-position', dte: 2 });
    const damped = selectManagementIntent({ context: 'other-position', dte: 2, breakevenPop: 94.3 }); // BE's real reading
    const undampedScore = undamped.candidates.find((c) => c.intent === 'REDUCE_RISK')?.score ?? 0;
    const dampedScore = damped.candidates.find((c) => c.intent === 'REDUCE_RISK')?.score ?? 0;
    expect(dampedScore).toBeLessThan(undampedScore);
    expect(dampedScore).toBeGreaterThan(0); // floor -- never fully suppressed
  });

  it('a moderate breakeven-POP (below the dampening threshold) leaves the contribution untouched', () => {
    const undamped = selectManagementIntent({ context: 'other-position', dte: 2 });
    const mu = selectManagementIntent({ context: 'other-position', dte: 2, breakevenPop: 72.4 }); // MU's real reading
    const undampedScore = undamped.candidates.find((c) => c.intent === 'REDUCE_RISK')?.score ?? 0;
    const muScore = mu.candidates.find((c) => c.intent === 'REDUCE_RISK')?.score ?? 0;
    expect(muScore).toBe(undampedScore);
  });

  it('a high breakeven-POP far from the DTE window has negligible effect (dampening multiplies an already-small base)', () => {
    const undamped = selectManagementIntent({ context: 'other-position', dte: 18 });
    const damped = selectManagementIntent({ context: 'other-position', dte: 18, breakevenPop: 94.3 });
    const undampedScore = undamped.candidates.find((c) => c.intent === 'REDUCE_RISK')?.score ?? 0;
    const dampedScore = damped.candidates.find((c) => c.intent === 'REDUCE_RISK')?.score ?? 0;
    // Both small; dampening still applies proportionally but the absolute
    // gap is tiny compared to the near-expiration case above.
    expect(dampedScore).toBeLessThanOrEqual(undampedScore);
  });

  it('surfaces the dampening in the Reduce Risk reasons text only when actually active', () => {
    const damped = selectManagementIntent({ context: 'other-position', dte: 2, breakevenPop: 94.3 });
    const reduceRisk = damped.candidates.find((c) => c.intent === 'REDUCE_RISK');
    expect(reduceRisk!.reasons.some((r) => r.includes('probability of profit'))).toBe(true);

    const undamped = selectManagementIntent({ context: 'other-position', dte: 2, breakevenPop: 72.4 });
    const reduceRiskUndamped = undamped.candidates.find((c) => c.intent === 'REDUCE_RISK');
    expect(reduceRiskUndamped!.reasons.some((r) => r.includes('probability of profit'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Remaining Opportunity contribution, in isolation
// ---------------------------------------------------------------------------

describe('selectManagementIntent: Remaining Opportunity (PI-0008A metric, wired into scoring for the first time in PI-0008B)', () => {
  it('low remaining opportunity on a profitable position supports Take Profit', () => {
    const result = selectManagementIntent({
      context: 'credit-spread',
      pnlPct: 30,
      remainingOpportunityPct: 5,
    });
    expect(result.intent).toBe('TAKE_PROFIT');
    const winner = result.candidates.find((c) => c.isWinner)!;
    expect(winner.contributions.some((c) => c.id === 'remaining-opportunity-low-take-profit')).toBe(true);
  });

  it('low remaining opportunity on a flat/losing position supports Reduce Risk, not an automatic Cut Losses', () => {
    const result = selectManagementIntent({
      context: 'credit-spread',
      pnlPct: -10,
      remainingOpportunityPct: 5,
    });
    expect(result.intent).toBe('REDUCE_RISK');
    expect(result.intent).not.toBe('CUT_LOSSES');
  });

  it('high remaining opportunity supports Hold Position', () => {
    const result = selectManagementIntent({
      context: 'credit-spread',
      pnlPct: 5,
      remainingOpportunityPct: 95,
    });
    expect(result.intent).toBe('HOLD_POSITION');
    const winner = result.candidates.find((c) => c.isWinner)!;
    expect(winner.contributions.some((c) => c.id === 'remaining-opportunity-high-hold')).toBe(true);
  });

  it('mid-range remaining opportunity (neither low nor high) contributes nothing', () => {
    const result = selectManagementIntent({
      context: 'credit-spread',
      remainingOpportunityPct: 45,
    });
    expect(result.winnerScore).toBe(W.holdBaseline);
  });
});

// ---------------------------------------------------------------------------
// Earnings proximity, scaled (previously a fixed 0)
// ---------------------------------------------------------------------------

describe('selectManagementIntent: earnings proximity now carries real weight', () => {
  it('earnings closer to today (higher proximity fraction) adds more weight to the leader than earnings farther out', () => {
    const closer = selectManagementIntent({
      context: 'credit-spread',
      itmOrCriticalBuffer: true,
      earningsActionable: true,
      earningsProximityFraction: 0.9,
    });
    const farther = selectManagementIntent({
      context: 'credit-spread',
      itmOrCriticalBuffer: true,
      earningsActionable: true,
      earningsProximityFraction: 0.1,
    });
    expect(closer.winnerScore).toBeGreaterThan(farther.winnerScore);
  });

  it('falls back to a fixed moderate fraction when the caller has not computed one', () => {
    const withFallback = selectManagementIntent({
      context: 'credit-spread',
      itmOrCriticalBuffer: true,
      earningsActionable: true,
    });
    const explicitHalf = selectManagementIntent({
      context: 'credit-spread',
      itmOrCriticalBuffer: true,
      earningsActionable: true,
      earningsProximityFraction: 0.5,
    });
    expect(withFallback.winnerScore).toBe(explicitHalf.winnerScore);
  });
});

// ---------------------------------------------------------------------------
// Ticket validation scenario #1: SOXL, ~17 DTE Bull Put Spread, severe
// compounding evidence -- "Likely Cut Losses."
// ---------------------------------------------------------------------------

describe('Validation scenario: SOXL-style ~17 DTE Bull Put Spread with severe compounding evidence', () => {
  it('resolves to Cut Losses when a real loss-policy breach compounds with a tight buffer, negative/declined net edge, and an adverse trend', () => {
    const { legacyRecommendation } = evaluatePositionObjective(
      baseInput({
        symbol: 'SOXL',
        dte: 17,
        pnlPct: -105, // beyond the -100% loss-stop policy
        buffer: 1.5, // tight/ITM
        healthScore: { positionId: 'pos_1', symbol: 'SOXL', score: 20, grade: 'action', summary: '', factors: [], computedAt: NOW.toISOString() },
        netEdgeDeclinePct: -45,
        netEdgeNegative: true,
        technicalAlignment: 'against',
      }),
      NOW,
    );
    expect(legacyRecommendation.managementIntent!.intent).toBe('CUT_LOSSES');
    expect(legacyRecommendation.label).toBe('Cut Losses');
    expectInternallyConsistent(legacyRecommendation.managementIntent!);
  });
});

// ---------------------------------------------------------------------------
// Ticket validation scenario #2: SOXL, ~38 DTE Bull Put Spread, healthy
// evidence -- "Likely Hold Position."
// ---------------------------------------------------------------------------

describe('Validation scenario: SOXL-style ~38 DTE Bull Put Spread with healthy evidence', () => {
  it('resolves to Hold Position when well outside the management window with no risk evidence', () => {
    const { legacyRecommendation } = evaluatePositionObjective(
      baseInput({
        symbol: 'SOXL',
        dte: 38,
        pnlPct: 12,
        buffer: 7,
        healthScore: { positionId: 'pos_1', symbol: 'SOXL', score: 85, grade: 'excellent', summary: '', factors: [], computedAt: NOW.toISOString() },
        netEdgeDeclinePct: -5,
        netEdgeNegative: false,
        technicalAlignment: 'neutral',
      }),
      NOW,
    );
    expect(legacyRecommendation.managementIntent!.intent).toBe('HOLD_POSITION');
    expect(legacyRecommendation.label).toBe('Hold Position');
    expectInternallyConsistent(legacyRecommendation.managementIntent!);
  });
});

// ---------------------------------------------------------------------------
// Ticket validation scenario #3: AMD -- internal consistency, not a specific
// intent.
// ---------------------------------------------------------------------------

describe('Validation scenario: AMD-style position with mixed, moderate evidence', () => {
  it('produces an internally consistent recommendation regardless of which intent wins', () => {
    const { legacyRecommendation, objective } = evaluatePositionObjective(
      baseInput({
        symbol: 'AMD',
        strategy: 'BPS',
        dte: 19,
        pnlPct: -15,
        buffer: 4,
        healthScore: { positionId: 'pos_1', symbol: 'AMD', score: 60, grade: 'watch', summary: '', factors: [], computedAt: NOW.toISOString() },
        earningsDate: '2026-07-19',
        expDate: '2026-08-15',
      }),
      NOW,
    );
    expectInternallyConsistent(legacyRecommendation.managementIntent!);
    expect(objective!.managementIntent!.intent).toBe(legacyRecommendation.managementIntent!.intent);
  });
});

// ---------------------------------------------------------------------------
// Ticket validation scenario #4: NVDA Cash Secured Put -- internal
// consistency, not a specific intent.
// ---------------------------------------------------------------------------

describe('Validation scenario: NVDA-style Wheel Cash Secured Put', () => {
  it('produces an internally consistent recommendation regardless of which intent wins', () => {
    const { legacyRecommendation } = evaluatePositionObjective(
      baseInput({
        symbol: 'NVDA',
        strategy: 'CSP',
        positionStrategy: 'WHEEL',
        assignmentPreference: 'PREFER',
        dte: 12,
        pnlPct: 18,
        buffer: 6,
        healthScore: { positionId: 'pos_1', symbol: 'NVDA', score: 82, grade: 'good', summary: '', factors: [], computedAt: NOW.toISOString() },
      }),
      NOW,
    );
    expectInternallyConsistent(legacyRecommendation.managementIntent!);
    // Wheel-relevant intents only -- never a bare "abandon the Wheel" result.
    for (const candidate of legacyRecommendation.managementIntent!.candidates) {
      expect(['HOLD_POSITION', 'TAKE_PROFIT', 'ACCEPT_ASSIGNMENT', 'ROLL_POSITION', 'CUT_LOSSES']).toContain(candidate.intent);
    }
  });
});
