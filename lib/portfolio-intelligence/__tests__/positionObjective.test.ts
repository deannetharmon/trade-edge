// lib/portfolio-intelligence/__tests__/positionObjective.test.ts
//
// PI-0002 regression: evaluatePositionObjective() consolidates TE-0006B
// (features/portfolio/recommendations/*). These tests prove parity with
// the original calculatePortfolioRecommendation() -- same trigger
// conditions, same thresholds, same wording -- for every one of its nine
// branches, plus the new canonical-objective behavior layered on top
// (stable rule IDs, execution flags, the deliberate hold -> null change).

import { describe, expect, it } from 'vitest';
import { evaluatePositionObjective } from '@/lib/portfolio-intelligence';
import type { PositionObjectiveInput } from '@/lib/portfolio-intelligence';

const NOW = new Date('2026-07-11T13:00:00.000Z');

function baseInput(overrides: Partial<PositionObjectiveInput> = {}): PositionObjectiveInput {
  return {
    positionId: 'pos_1',
    symbol: 'AMD',
    strategy: 'BPS',
    dte: 30,
    pnlPct: 10,
    buffer: 8,
    hasGtc: true,
    ...overrides,
  };
}

describe('PI-002: assignment-risk parity', () => {
  it('fires assignment-risk (critical) for short premium, <=7 DTE, ITM/critical buffer', () => {
    const { legacyRecommendation, objective } = evaluatePositionObjective(
      baseInput({ dte: 5, buffer: 1.5 }),
      NOW,
    );
    expect(legacyRecommendation.kind).toBe('assignment-risk');
    expect(legacyRecommendation.urgency).toBe('critical');
    expect(legacyRecommendation.confidence).toBe(94);
    // PI-0006B: `label` is now sourced from the canonical intent selector
    // rather than PI-0006A's static per-kind lookup ('Exit Position'). This
    // fixture has a tight/ITM buffer with no material loss and no roll
    // evidence -- that's Reduce Risk evidence, not a loss-stop breach, so the
    // decisive label is 'Reduce Risk'. `kind`/`ruleId`/`type` (asserted
    // below) are unchanged, per ticket requirement #8.
    expect(legacyRecommendation.label).toBe('Reduce Risk');
    expect(legacyRecommendation.managementIntent?.intent).toBe('REDUCE_RISK');
    expect(objective).not.toBeNull();
    expect(objective!.type).toBe('REVIEW_THREATENED_POSITION');
    expect(objective!.ruleId).toBe('OBJ-ASSIGNMENT-RISK');
    expect(objective!.priority).toBe('critical');
  });
});

describe('PI-002: close-loser parity', () => {
  it('fires close-loser (critical) at or beyond -100% (1x credit)', () => {
    const { legacyRecommendation, objective } = evaluatePositionObjective(baseInput({ pnlPct: -110 }), NOW);
    expect(legacyRecommendation.kind).toBe('close-loser');
    expect(legacyRecommendation.urgency).toBe('critical');
    expect(legacyRecommendation.confidence).toBe(91);
    expect(objective!.priority).toBe('critical');
    expect(objective!.ruleId).toBe('OBJ-CLOSE-LOSER');
  });

  it('fires close-loser (high) at -50% combined with health score < 50', () => {
    const { legacyRecommendation, objective } = evaluatePositionObjective(
      baseInput({ pnlPct: -60, healthScore: { positionId: 'pos_1', symbol: 'AMD', score: 40, grade: 'action', summary: '', factors: [], computedAt: NOW.toISOString() } }),
      NOW,
    );
    expect(legacyRecommendation.kind).toBe('close-loser');
    expect(legacyRecommendation.urgency).toBe('high');
    expect(legacyRecommendation.confidence).toBe(84);
    expect(objective!.priority).toBe('high');
  });
});

describe('PI-002: earnings-risk parity', () => {
  it('fires earnings-risk when earnings fall before expiration', () => {
    const { legacyRecommendation, objective } = evaluatePositionObjective(
      baseInput({ dte: 25, earningsDate: '2026-07-15', expDate: '2026-08-05', pnlPct: 10 }),
      NOW,
    );
    expect(legacyRecommendation.kind).toBe('earnings-risk');
    expect(legacyRecommendation.urgency).toBe('high');
    expect(legacyRecommendation.confidence).toBe(86);
    expect(objective!.type).toBe('REVIEW_THREATENED_POSITION');
  });
});

describe('PI-002: close-winner parity', () => {
  it('fires close-winner at or above 50% profit', () => {
    const { legacyRecommendation, objective } = evaluatePositionObjective(baseInput({ pnlPct: 55, dte: 25 }), NOW);
    expect(legacyRecommendation.kind).toBe('close-winner');
    expect(legacyRecommendation.urgency).toBe('high');
    expect(legacyRecommendation.confidence).toBe(90);
    expect(objective!.type).toBe('CLOSE_FOR_PROFIT');
    expect(objective!.ruleId).toBe('OBJ-CLOSE-FOR-PROFIT');
  });

  it('fires close-winner when hitTarget is explicitly true regardless of pnlPct', () => {
    const { legacyRecommendation } = evaluatePositionObjective(baseInput({ hitTarget: true, pnlPct: 30, dte: 25 }), NOW);
    expect(legacyRecommendation.kind).toBe('close-winner');
  });
});

describe('PI-002: roll-soon parity (21-DTE management)', () => {
  it('fires roll-soon for short-premium strategies inside the 21/7 DTE window', () => {
    const { legacyRecommendation, objective } = evaluatePositionObjective(baseInput({ dte: 18, pnlPct: 10 }), NOW);
    expect(legacyRecommendation.kind).toBe('roll-soon');
    expect(legacyRecommendation.urgency).toBe('medium');
    expect(legacyRecommendation.confidence).toBe(80);
    expect(legacyRecommendation.primaryReason).toContain('18 DTE');
    expect(objective!.type).toBe('MANAGE_POSITION');
    expect(objective!.ruleId).toBe('OBJ-MANAGE-21-DTE');
  });

  it('does not fire roll-soon outside the window (dte > 21)', () => {
    const { legacyRecommendation } = evaluatePositionObjective(baseInput({ dte: 30, pnlPct: 10 }), NOW);
    expect(legacyRecommendation.kind).not.toBe('roll-soon');
  });
});

describe('PI-002: place-gtc parity', () => {
  it('fires place-gtc when profit exists, no GTC, and dte > 14', () => {
    const { legacyRecommendation, objective } = evaluatePositionObjective(
      baseInput({ dte: 25, pnlPct: 25, hasGtc: false }),
      NOW,
    );
    expect(legacyRecommendation.kind).toBe('place-gtc');
    expect(legacyRecommendation.urgency).toBe('medium');
    expect(legacyRecommendation.confidence).toBe(78);
    expect(objective!.type).toBe('MANAGE_POSITION');
  });
});

describe('PI-002: let-expire parity', () => {
  it('fires let-expire for a healthy position at <=3 DTE with no critical buffer flag', () => {
    const { legacyRecommendation } = evaluatePositionObjective(
      baseInput({
        dte: 2,
        pnlPct: 10,
        buffer: 10,
        healthScore: { positionId: 'pos_1', symbol: 'AMD', score: 80, grade: 'good', summary: '', factors: [], computedAt: NOW.toISOString() },
      }),
      NOW,
    );
    expect(legacyRecommendation.kind).toBe('let-expire');
    expect(legacyRecommendation.urgency).toBe('low');
    expect(legacyRecommendation.confidence).toBe(72);
  });
});

describe('PI-002: watch parity', () => {
  it('fires watch when health score is below 75 with no higher-priority trigger', () => {
    const { legacyRecommendation, objective } = evaluatePositionObjective(
      baseInput({
        dte: 30,
        pnlPct: 5,
        buffer: 8,
        healthScore: { positionId: 'pos_1', symbol: 'AMD', score: 65, grade: 'watch', summary: '', factors: [], computedAt: NOW.toISOString() },
      }),
      NOW,
    );
    expect(legacyRecommendation.kind).toBe('watch');
    expect(legacyRecommendation.urgency).toBe('medium');
    expect(legacyRecommendation.confidence).toBe(70);
    expect(objective!.type).toBe('MANAGE_POSITION');
  });
});

describe('PI-002: hold parity and the deliberate objective:null change', () => {
  it('fires hold when nothing else triggers, legacyRecommendation always populated', () => {
    const { legacyRecommendation, objective } = evaluatePositionObjective(
      baseInput({
        dte: 30,
        pnlPct: 10,
        buffer: 8,
        hasGtc: true,
        healthScore: { positionId: 'pos_1', symbol: 'AMD', score: 85, grade: 'excellent', summary: '', factors: [], computedAt: NOW.toISOString() },
      }),
      NOW,
    );
    expect(legacyRecommendation.kind).toBe('hold');
    expect(legacyRecommendation.urgency).toBe('low');
    expect(legacyRecommendation.confidence).toBe(76);
    expect(legacyRecommendation.label).toBe('Hold Position');
    // Deliberate PI-0002 design decision: unlike the old system (which always
    // returned a recommendation object), the canonical objective is null for
    // "nothing to act on" -- consistent with evaluatePortfolioObjectives'
    // existing philosophy. This is documented, not an accidental regression.
    expect(objective).toBeNull();
  });
});

describe('PI-002/PI-003: stable rule IDs', () => {
  it('every non-null objective carries the correct fine-grained ruleId (PI-0003)', () => {
    const expectations: [PositionObjectiveInput, string][] = [
      [baseInput({ dte: 5, buffer: 1.5 }), 'OBJ-ASSIGNMENT-RISK'],
      [baseInput({ pnlPct: -110 }), 'OBJ-CLOSE-LOSER'],
      [baseInput({ pnlPct: 55, dte: 25 }), 'OBJ-CLOSE-FOR-PROFIT'],
      [baseInput({ dte: 18, pnlPct: 10 }), 'OBJ-MANAGE-21-DTE'],
      [baseInput({ dte: 25, pnlPct: 25, hasGtc: false }), 'OBJ-PLACE-GTC'],
      [baseInput({ pnlPct: -25, marketablePnlPct: -125, marketableQuoteQuality: 'DEGRADED', marketableQuoteFreshness: 'UNKNOWN' }), 'OBJ-VERIFY-PRICING'],
    ];
    for (const [input, expectedRuleId] of expectations) {
      const { objective } = evaluatePositionObjective(input, NOW);
      expect(objective).not.toBeNull();
      expect(objective!.ruleId).toBe(expectedRuleId);
    }
  });

  it('every produced ruleId is consistent with its objective type (isRuleIdConsistentWithType)', async () => {
    const { isRuleIdConsistentWithType } = await import('@/lib/portfolio-intelligence');
    const scenarios: PositionObjectiveInput[] = [
      baseInput({ dte: 5, buffer: 1.5 }),
      baseInput({ pnlPct: -110 }),
      baseInput({ pnlPct: 55, dte: 25 }),
      baseInput({ dte: 18, pnlPct: 10 }),
      baseInput({ dte: 25, pnlPct: 25, hasGtc: false }),
    ];
    for (const input of scenarios) {
      const { objective } = evaluatePositionObjective(input, NOW);
      expect(objective).not.toBeNull();
      expect(isRuleIdConsistentWithType(objective!.ruleId, objective!.type)).toBe(true);
    }
  });

  it('portfolio-level objectives (from evaluatePortfolioObjectives) also carry correct ruleIds', async () => {
    const { evaluatePortfolioObjectives } = await import('@/lib/portfolio-intelligence');
    const { makeContext, makePosition } = await import(
      '../../../test/fixtures/portfolioIntelligenceFixtures'
    );
    const objectives = evaluatePortfolioObjectives(
      makeContext({ positions: [makePosition({ pctOfMaxProfitCaptured: 60 })] }),
    );
    expect(objectives[0].ruleId).toBe('OBJ-CLOSE-FOR-PROFIT');
  });
});

describe('PI-002: safety', () => {
  it('every non-null objective across all branches has both execution flags false', () => {
    const scenarios: PositionObjectiveInput[] = [
      baseInput({ dte: 5, buffer: 1.5 }),
      baseInput({ pnlPct: -110 }),
      baseInput({ dte: 25, earningsDate: '2026-07-15', expDate: '2026-08-05' }),
      baseInput({ pnlPct: 55, dte: 25 }),
      baseInput({ dte: 18, pnlPct: 10 }),
      baseInput({ dte: 25, pnlPct: 25, hasGtc: false }),
    ];
    for (const input of scenarios) {
      const { objective } = evaluatePositionObjective(input, NOW);
      expect(objective).not.toBeNull();
      expect(objective!.metadata.executionAllowed).toBe(false);
      expect(objective!.metadata.paperExecutionAllowed).toBe(false);
    }
  });

  it('is a pure function: identical input produces equivalent output (excluding id)', () => {
    const input = baseInput({ pnlPct: 55, dte: 25 });
    const a = evaluatePositionObjective(input, NOW);
    const b = evaluatePositionObjective(input, NOW);
    expect(a.legacyRecommendation).toEqual(b.legacyRecommendation);
    expect({ ...a.objective, id: undefined }).toEqual({ ...b.objective, id: undefined });
  });
});
