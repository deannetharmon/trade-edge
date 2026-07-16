// lib/priorityScore/__tests__/priorityScore.test.ts
//
// PI-0010B: targeted tests for the deterministic Priority Score. Most tests
// isolate a single factor by zeroing every other factor's weight in a
// custom config, so the resulting score is a direct, checkable function of
// just that one factor's normalized value.

import { describe, expect, it } from 'vitest';
import { calculatePriorityScore } from '../priorityScore';
import type { PriorityScoreInput, PriorityScoreObjectiveInput, PriorityScorePositionContext } from '../priorityScore';
import { DEFAULT_PRIORITY_SCORE_CONFIG, type PriorityScoreConfig } from '../config';
import type { ObjectiveImpact, PortfolioObjectiveReviewTrigger } from '@/lib/portfolio-intelligence';

const ZERO_IMPACT: ObjectiveImpact = { direction: 'neutral', magnitude: 'low', explanation: '' };

function makeObjectiveInput(overrides: Partial<PriorityScoreObjectiveInput> = {}): PriorityScoreObjectiveInput {
  return {
    confidence: 50,
    managementIntent: null,
    reviewTriggers: [],
    capitalImpact: ZERO_IMPACT,
    ...overrides,
  };
}

function makePositionContext(overrides: Partial<PriorityScorePositionContext> = {}): PriorityScorePositionContext {
  return {
    dte: 30,
    healthScore: 70,
    netEdgeDeclinePct: 0,
    netEdgeNegative: false,
    remainingOpportunityPct: 70,
    capitalAtRisk: 0,
    hasPendingDecisionReview: false,
    ...overrides,
  };
}

// Isolates exactly one factor by zeroing every weight except the one named,
// so score === round(factorValue * 100) deterministically.
function isolatingConfig(factor: keyof PriorityScoreConfig['factorWeights']): PriorityScoreConfig {
  const zeroed = Object.fromEntries(
    Object.keys(DEFAULT_PRIORITY_SCORE_CONFIG.factorWeights).map((k) => [k, 0]),
  ) as unknown as PriorityScoreConfig['factorWeights'];
  const factorWeights: PriorityScoreConfig['factorWeights'] = { ...zeroed, [factor]: 1 };
  return { ...DEFAULT_PRIORITY_SCORE_CONFIG, factorWeights };
}

describe('calculatePriorityScore: confidence factor', () => {
  it('scores proportionally to objective.confidence when isolated', () => {
    const config = isolatingConfig('confidence');
    const input: PriorityScoreInput = { objective: makeObjectiveInput({ confidence: 80 }), position: makePositionContext() };
    expect(calculatePriorityScore(input, config).score).toBe(80);
  });
});

describe('calculatePriorityScore: management intent factor', () => {
  it('gives CUT_LOSSES full urgency', () => {
    const config = isolatingConfig('managementIntent');
    const input: PriorityScoreInput = {
      objective: makeObjectiveInput({ managementIntent: { intent: 'CUT_LOSSES' } }),
      position: makePositionContext(),
    };
    expect(calculatePriorityScore(input, config).score).toBe(100);
  });

  it('gives HOLD_POSITION low urgency', () => {
    const config = isolatingConfig('managementIntent');
    const input: PriorityScoreInput = {
      objective: makeObjectiveInput({ managementIntent: { intent: 'HOLD_POSITION' } }),
      position: makePositionContext(),
    };
    expect(calculatePriorityScore(input, config).score).toBe(15);
  });

  it('falls back to defaultManagementIntentUrgency when no managementIntent is present', () => {
    const config = isolatingConfig('managementIntent');
    const input: PriorityScoreInput = { objective: makeObjectiveInput({ managementIntent: null }), position: makePositionContext() };
    expect(calculatePriorityScore(input, config).score).toBe(Math.round(config.defaultManagementIntentUrgency * 100));
  });
});

describe('calculatePriorityScore: gamma/DTE factor', () => {
  it('is highest at 0 DTE and near zero far from expiration (21-day window)', () => {
    const config = isolatingConfig('gammaDte');
    const atExpiry = calculatePriorityScore({ objective: makeObjectiveInput(), position: makePositionContext({ dte: 0 }) }, config).score;
    const farOut = calculatePriorityScore({ objective: makeObjectiveInput(), position: makePositionContext({ dte: 21 }) }, config).score;
    expect(atExpiry).toBe(100);
    expect(farOut).toBe(0);
  });

  it('is 0 when there is no position context at all', () => {
    const config = isolatingConfig('gammaDte');
    const result = calculatePriorityScore({ objective: makeObjectiveInput(), position: null }, config);
    expect(result.score).toBe(0);
  });
});

describe('calculatePriorityScore: Net Edge deterioration factor', () => {
  it('scales with netEdgeDeclinePct up to the configured reference', () => {
    const config = isolatingConfig('netEdgeDeterioration');
    const result = calculatePriorityScore(
      { objective: makeObjectiveInput(), position: makePositionContext({ netEdgeDeclinePct: 25 }) },
      config,
    );
    expect(result.score).toBe(Math.round((25 / config.netEdgeDeclineReferencePct) * 100));
  });

  it('saturates to full urgency when netEdgeNegative is true regardless of decline pct', () => {
    const config = isolatingConfig('netEdgeDeterioration');
    const result = calculatePriorityScore(
      { objective: makeObjectiveInput(), position: makePositionContext({ netEdgeDeclinePct: 0, netEdgeNegative: true }) },
      config,
    );
    expect(result.score).toBe(100);
  });
});

describe('calculatePriorityScore: Position Health factor', () => {
  it('scores higher urgency for lower health scores', () => {
    const config = isolatingConfig('positionHealth');
    const healthy = calculatePriorityScore({ objective: makeObjectiveInput(), position: makePositionContext({ healthScore: 90 }) }, config).score;
    const unhealthy = calculatePriorityScore({ objective: makeObjectiveInput(), position: makePositionContext({ healthScore: 20 }) }, config).score;
    expect(unhealthy).toBeGreaterThan(healthy);
  });

  it('uses the configured neutral default when no position context is available', () => {
    const config = isolatingConfig('positionHealth');
    const result = calculatePriorityScore({ objective: makeObjectiveInput(), position: null }, config);
    expect(result.score).toBe(Math.round(config.missingPositionHealthFactor * 100));
  });
});

describe('calculatePriorityScore: Remaining Opportunity factor', () => {
  it('scores higher urgency when little opportunity remains', () => {
    const config = isolatingConfig('remainingOpportunity');
    const lots = calculatePriorityScore({ objective: makeObjectiveInput(), position: makePositionContext({ remainingOpportunityPct: 90 }) }, config).score;
    const little = calculatePriorityScore({ objective: makeObjectiveInput(), position: makePositionContext({ remainingOpportunityPct: 10 }) }, config).score;
    expect(little).toBeGreaterThan(lots);
  });
});

describe('calculatePriorityScore: Earnings Proximity factor', () => {
  it('is fully urgent when reviewTriggers includes an earnings trigger', () => {
    const config = isolatingConfig('earningsProximity');
    const trigger: PortfolioObjectiveReviewTrigger = { id: 't1', label: 'Earnings', triggerType: 'earnings', explanation: '' };
    const result = calculatePriorityScore(
      { objective: makeObjectiveInput({ reviewTriggers: [trigger] }), position: makePositionContext() },
      config,
    );
    expect(result.score).toBe(100);
  });

  it('is 0 with no earnings trigger present', () => {
    const config = isolatingConfig('earningsProximity');
    const result = calculatePriorityScore({ objective: makeObjectiveInput({ reviewTriggers: [] }), position: makePositionContext() }, config);
    expect(result.score).toBe(0);
  });
});

describe('calculatePriorityScore: Capital At Risk factor', () => {
  it('prefers position.capitalAtRisk over the objective capitalImpact dollar value', () => {
    const config = isolatingConfig('capitalAtRisk');
    const result = calculatePriorityScore(
      {
        objective: makeObjectiveInput({ capitalImpact: { ...ZERO_IMPACT, estimatedDollarValue: 999999 } }),
        position: makePositionContext({ capitalAtRisk: config.capitalAtRiskReferenceUsd }),
      },
      config,
    );
    expect(result.score).toBe(100);
  });

  it('falls back to objective.capitalImpact.estimatedDollarValue when position context is null', () => {
    const config = isolatingConfig('capitalAtRisk');
    const result = calculatePriorityScore(
      { objective: makeObjectiveInput({ capitalImpact: { ...ZERO_IMPACT, estimatedDollarValue: config.capitalAtRiskReferenceUsd / 2 } }), position: null },
      config,
    );
    expect(result.score).toBe(50);
  });
});

describe('calculatePriorityScore: Decision Review follow-up factor', () => {
  it('is fully urgent when hasPendingDecisionReview is true', () => {
    const config = isolatingConfig('decisionReviewFollowUp');
    const result = calculatePriorityScore(
      { objective: makeObjectiveInput(), position: makePositionContext({ hasPendingDecisionReview: true }) },
      config,
    );
    expect(result.score).toBe(100);
  });
});

describe('calculatePriorityScore: tiers', () => {
  it('assigns Critical/High/Medium/Low per the configured thresholds', () => {
    const config: PriorityScoreConfig = {
      ...DEFAULT_PRIORITY_SCORE_CONFIG,
      factorWeights: { ...DEFAULT_PRIORITY_SCORE_CONFIG.factorWeights, confidence: 1, managementIntent: 0, gammaDte: 0, netEdgeDeterioration: 0, positionHealth: 0, remainingOpportunity: 0, earningsProximity: 0, capitalAtRisk: 0, decisionReviewFollowUp: 0 },
    };
    expect(calculatePriorityScore({ objective: makeObjectiveInput({ confidence: 80 }), position: makePositionContext() }, config).tier).toBe('Critical');
    expect(calculatePriorityScore({ objective: makeObjectiveInput({ confidence: 60 }), position: makePositionContext() }, config).tier).toBe('High');
    expect(calculatePriorityScore({ objective: makeObjectiveInput({ confidence: 35 }), position: makePositionContext() }, config).tier).toBe('Medium');
    expect(calculatePriorityScore({ objective: makeObjectiveInput({ confidence: 10 }), position: makePositionContext() }, config).tier).toBe('Low');
  });
});

describe('calculatePriorityScore: reasons', () => {
  it('includes only factors at or above the inclusion threshold, highest-contribution first, capped at maxReasons', () => {
    const config: PriorityScoreConfig = { ...DEFAULT_PRIORITY_SCORE_CONFIG, maxReasons: 2 };
    const trigger: PortfolioObjectiveReviewTrigger = { id: 't1', label: 'Earnings', triggerType: 'earnings', explanation: '' };
    const input: PriorityScoreInput = {
      objective: makeObjectiveInput({ confidence: 95, managementIntent: { intent: 'CUT_LOSSES' }, reviewTriggers: [trigger] }),
      position: makePositionContext({ dte: 0, netEdgeNegative: true }),
    };
    const result = calculatePriorityScore(input, config);
    expect(result.reasons.length).toBeLessThanOrEqual(2);
    // managementIntent (weight 20) and netEdge/gammaDte (weight 15 each) all
    // fire at full or near-full value here and outweigh confidence (15) --
    // the management intent reason should be first.
    expect(result.reasons[0]).toBe('Recommendation: Cut Losses');
  });

  it('produces no reasons when every factor is below the inclusion threshold', () => {
    const input: PriorityScoreInput = {
      objective: makeObjectiveInput({ confidence: 0, managementIntent: null, reviewTriggers: [] }),
      position: makePositionContext({ dte: 30, healthScore: 100, netEdgeDeclinePct: 0, netEdgeNegative: false, remainingOpportunityPct: 100, capitalAtRisk: 0, hasPendingDecisionReview: false }),
    };
    expect(calculatePriorityScore(input).reasons).toHaveLength(0);
  });
});
