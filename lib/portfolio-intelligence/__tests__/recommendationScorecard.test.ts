// lib/portfolio-intelligence/__tests__/recommendationScorecard.test.ts
//
// PI-0007A: Recommendation Scorecard -- observability-only regression tests.
// This ticket must not change any PI-0006B decision: every test here either
// (a) re-runs a PI-0006B acceptance scenario and asserts the winning intent
// is unchanged, or (b) inspects the new scorecard fields (`candidates`,
// `winnerScore`, `runnerUpIntent`, `runnerUpScore`, `margin`,
// `confidenceTier`, and each candidate's `contributions`/`isWinner`) for
// internal consistency. None of these tests assert new scoring behavior --
// only that the existing behavior is now observable.

import { describe, expect, it } from 'vitest';
import { evaluatePositionObjective } from '@/lib/portfolio-intelligence';
import type { PositionObjectiveInput } from '@/lib/portfolio-intelligence';
import { selectManagementIntent, type ManagementIntentEvidence } from '../managementIntent';

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

// ---------------------------------------------------------------------------
// Contributions sum to totals; candidates are sorted correctly
// ---------------------------------------------------------------------------

describe('Scorecard: contributions sum exactly to each candidate total', () => {
  const scenarios: ManagementIntentEvidence[] = [
    { context: 'credit-spread', materialLoss: true },
    { context: 'credit-spread', itmOrCriticalBuffer: true, netEdgeNegative: true, technicalAlignment: 'against' },
    { context: 'wheel-csp', assignmentPreference: 'PREFER', weakHealthLoss: true },
    { context: 'pending-order', orderNeedsReplacement: true },
    { context: 'idle-cash', idleCashDeployable: true },
    { context: 'other-position' },
  ];

  it.each(scenarios)('every candidate\'s contributions sum to its score (%j)', (evidence) => {
    const result = selectManagementIntent(evidence);
    for (const candidate of result.candidates) {
      const summed = candidate.contributions.reduce((sum, c) => sum + c.points, 0);
      expect(summed).toBe(candidate.score);
    }
  });
});

describe('Scorecard: candidates are ranked score-descending, then existing tie-break order', () => {
  it('sorts strictly by score, ties broken by the existing INTENT_TIE_BREAK_ORDER', () => {
    const result = selectManagementIntent({
      context: 'credit-spread',
      itmOrCriticalBuffer: true,
      technicalAlignment: 'against',
    });
    for (let i = 1; i < result.candidates.length; i++) {
      expect(result.candidates[i - 1].score).toBeGreaterThanOrEqual(result.candidates[i].score);
    }
  });

  it('exactly one candidate is flagged isWinner, and it matches `intent`', () => {
    const result = selectManagementIntent({ context: 'credit-spread', materialLoss: true });
    const winners = result.candidates.filter((c) => c.isWinner);
    expect(winners).toHaveLength(1);
    expect(winners[0].intent).toBe(result.intent);
  });
});

describe('Scorecard: excluded intents never appear, even in the full candidate list', () => {
  it('idle-cash never surfaces Cut Losses/Take Profit/Reduce Risk in `candidates`', () => {
    const result = selectManagementIntent({ context: 'idle-cash', idleCashDeployable: true, materialLoss: true, profitTargetReached: true });
    const intents = result.candidates.map((c) => c.intent);
    expect(intents).not.toContain('CUT_LOSSES');
    expect(intents).not.toContain('TAKE_PROFIT');
    expect(intents).not.toContain('REDUCE_RISK');
  });

  it('pending-order only ever shows Replace Working Order / Hold Position', () => {
    const result = selectManagementIntent({ context: 'pending-order', orderNeedsReplacement: true });
    expect(result.candidates.map((c) => c.intent).sort()).toEqual(['HOLD_POSITION', 'REPLACE_WORKING_ORDER'].sort());
  });
});

// ---------------------------------------------------------------------------
// Decision margin + confidence tier -- exact values at/near the documented
// boundaries (High >= 30, Medium 15-29, Low < 15).
//
// PI-0008B: the exact winnerScore/runnerUpScore/margin values below were
// recomputed against decisionQualityMatrix.ts's weights (several of which
// changed as part of that ticket -- Net Edge, technical-against, and Health
// Score's one direct input all moved). The *tiers* these scenarios land on
// are exactly what they document (Low/Medium/High), which is the point of
// this test file; only the underlying numbers producing them changed.
// ---------------------------------------------------------------------------

describe('Scorecard: decision margin and confidence tier', () => {
  it('margin 0 (a tie broken only by tie-break order) is Low confidence', () => {
    // TAKE_PROFIT (40) and HOLD_POSITION (10 baseline + 30 technical-aligned)
    // both land on 40; TAKE_PROFIT wins the tie per INTENT_TIE_BREAK_ORDER.
    const result = selectManagementIntent({
      context: 'credit-spread',
      meaningfulUnprotectedProfit: true,
      technicalAlignment: 'aligned',
    });
    expect(result.intent).toBe('TAKE_PROFIT');
    expect(result.winnerScore).toBe(40);
    expect(result.runnerUpIntent).toBe('HOLD_POSITION');
    expect(result.runnerUpScore).toBe(40);
    expect(result.margin).toBe(0);
    expect(result.confidenceTier).toBe('Low');
  });

  it('margin 12 is Low confidence (just below the 15 threshold)', () => {
    // PI-0008B: technical-against weights increased (Cut Losses 30->38,
    // Reduce Risk 20->26) -- still a Low-confidence margin, just a wider one.
    const result = selectManagementIntent({ context: 'credit-spread', technicalAlignment: 'against' });
    expect(result.intent).toBe('CUT_LOSSES');
    expect(result.winnerScore).toBe(38);
    expect(result.runnerUpScore).toBe(26);
    expect(result.margin).toBe(12);
    expect(result.confidenceTier).toBe('Low');
  });

  it('margin 21 is Medium confidence', () => {
    // PI-0008B: Net Edge negative weights increased (Reduce Risk 30->42, the
    // Cut Losses nudge 15->21) as part of increasing Net Edge deterioration's
    // influence.
    const result = selectManagementIntent({ context: 'credit-spread', netEdgeNegative: true });
    expect(result.intent).toBe('REDUCE_RISK');
    expect(result.winnerScore).toBe(42);
    expect(result.runnerUpScore).toBe(21);
    expect(result.margin).toBe(21);
    expect(result.confidenceTier).toBe('Medium');
  });

  it('margin 35 is High confidence -- a concrete example of Health Score becoming supporting evidence, not a dominant driver', () => {
    // Before PI-0008B, this exact evidence combination (weakHealthLoss at the
    // old weight of 70) produced a margin of only 20 (Medium) against
    // assignment preference. Reducing weakHealthLoss to 55 -- Health Score's
    // one direct scoring input -- now lets an explicit, stated assignment
    // preference win with clearly High confidence instead of a close contest.
    const result = selectManagementIntent({
      context: 'wheel-csp',
      assignmentPreference: 'PREFER',
      weakHealthLoss: true,
    });
    expect(result.intent).toBe('ACCEPT_ASSIGNMENT');
    expect(result.winnerScore).toBe(90);
    expect(result.runnerUpScore).toBe(55);
    expect(result.margin).toBe(35);
    expect(result.confidenceTier).toBe('High');
  });

  it('margin 40 is High confidence', () => {
    // PI-0008B: Net Edge decline weight increased 40->50 (Net Edge
    // deterioration's influence), so this now clears the High threshold with
    // more room than the old exact-30 boundary case.
    const result = selectManagementIntent({ context: 'credit-spread', netEdgeDeclinePct: -25 });
    expect(result.intent).toBe('REDUCE_RISK');
    expect(result.winnerScore).toBe(50);
    expect(result.runnerUpScore).toBe(10);
    expect(result.margin).toBe(40);
    expect(result.confidenceTier).toBe('High');
  });

  it('a lone winner with no runner-up uses winnerScore as the margin (baseline-only Hold is Low, not High)', () => {
    const result = selectManagementIntent({ context: 'other-position' });
    expect(result.intent).toBe('HOLD_POSITION');
    expect(result.runnerUpIntent).toBeNull();
    expect(result.runnerUpScore).toBe(0);
    expect(result.margin).toBe(result.winnerScore);
    expect(result.margin).toBe(10);
    expect(result.confidenceTier).toBe('Low');
  });
});

// ---------------------------------------------------------------------------
// PI-0006B acceptance scenarios preserve the same winner (requirement #1)
// ---------------------------------------------------------------------------

describe('PI-0007A preserves PI-0006B acceptance-scenario winners exactly', () => {
  it('SOXL BPS: still resolves to Hold/Cut Losses/Reduce Risk, never Roll, and the scorecard explains the margin', () => {
    const { legacyRecommendation } = evaluatePositionObjective(
      baseInput({
        symbol: 'SOXL', dte: 17, pnlPct: -20,
        netEdgeDeclinePct: -40, technicalAlignment: 'against',
      }),
      NOW,
    );
    const mi = legacyRecommendation.managementIntent!;
    expect(['HOLD_POSITION', 'CUT_LOSSES', 'REDUCE_RISK']).toContain(mi.intent);
    expect(mi.intent).not.toBe('ROLL_POSITION');
    expect(mi.candidates.some((c) => c.intent === 'ROLL_POSITION')).toBe(true); // shown as a candidate
    expect(mi.candidates.find((c) => c.isWinner)?.intent).toBe(mi.intent);
    expect(mi.margin).toBe(mi.winnerScore - mi.runnerUpScore);
  });

  it('NVDA Wheel CSP: still resolves to Accept Assignment/Hold, and only Wheel-relevant intents are shown', () => {
    const { legacyRecommendation } = evaluatePositionObjective(
      baseInput({
        symbol: 'NVDA', strategy: 'CSP', positionStrategy: 'WHEEL',
        assignmentPreference: 'PREFER', dte: 25, pnlPct: 8,
      }),
      NOW,
    );
    const mi = legacyRecommendation.managementIntent!;
    expect(['ACCEPT_ASSIGNMENT', 'HOLD_POSITION']).toContain(mi.intent);
    const intents = mi.candidates.map((c) => c.intent);
    for (const intent of intents) {
      expect(['HOLD_POSITION', 'TAKE_PROFIT', 'ACCEPT_ASSIGNMENT', 'ROLL_POSITION', 'CUT_LOSSES']).toContain(intent);
    }
  });

  it('Profit Target: still resolves to Take Profit, with profit-target evidence visible as a contribution', () => {
    const { legacyRecommendation } = evaluatePositionObjective(
      baseInput({ symbol: 'PLTR', hitTarget: true, pnlPct: 55, dte: 25 }),
      NOW,
    );
    const mi = legacyRecommendation.managementIntent!;
    expect(mi.intent).toBe('TAKE_PROFIT');
    const winner = mi.candidates.find((c) => c.isWinner)!;
    expect(winner.contributions.some((c) => c.evidenceField === 'profitTargetReached')).toBe(true);
  });

  it('Material Loss: still resolves to Cut Losses, with the material-loss contribution visible', () => {
    const { legacyRecommendation } = evaluatePositionObjective(
      baseInput({ symbol: 'SOFI', pnlPct: -110 }),
      NOW,
    );
    const mi = legacyRecommendation.managementIntent!;
    expect(mi.intent).toBe('CUT_LOSSES');
    const winner = mi.candidates.find((c) => c.isWinner)!;
    expect(winner.contributions.some((c) => c.evidenceField === 'materialLoss')).toBe(true);
  });

  it('Weak-Evidence Position: Hold may win on baseline alone, with Low confidence', () => {
    const { legacyRecommendation } = evaluatePositionObjective(
      baseInput({ symbol: 'WEAK', dte: 30, pnlPct: 5, buffer: 8 }),
      NOW,
    );
    const mi = legacyRecommendation.managementIntent!;
    expect(mi.intent).toBe('HOLD_POSITION');
    expect(mi.confidenceTier).toBe('Low');
  });
});
