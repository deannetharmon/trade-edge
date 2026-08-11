import { describe, expect, it } from 'vitest';
import type { PortfolioObjective } from '@/lib/portfolio-intelligence';
import type { PrioritizedObjective } from '../dashboard';
import { buildRecommendationExplanation } from '../explanation';

function objective(overrides: Partial<PortfolioObjective> = {}): PortfolioObjective {
  return {
    id: 'objective-1',
    createdAt: '2026-07-20T12:00:00.000Z',
    version: 'portfolio-objective-v1',
    type: 'REVIEW_THREATENED_POSITION',
    ruleId: 'OBJ-CLOSE-LOSER',
    title: 'Reduce Risk: SMH',
    summary: 'Loss threshold crossed.',
    priority: 'high',
    urgency: 'today',
    actionability: 'ACTION_NEEDED',
    confidence: 92,
    status: 'active',
    source: 'position',
    subject: { type: 'position', id: 'smh-position', symbol: 'SMH', label: 'SMH position' },
    rationale: 'Risk has increased.',
    supportingEvidence: [
      {
        id: 'net-edge',
        label: 'Net Edge',
        value: '0.82 → 0.47',
        tone: 'negative',
        explanation: 'Net Edge fell below the management threshold.',
      },
      {
        id: 'profit',
        label: 'Profit Captured',
        value: '12%',
        tone: 'neutral',
      },
    ],
    concerns: [],
    portfolioImpact: { direction: 'negative', magnitude: 'high', explanation: 'Downside remains elevated.' },
    incomeImpact: { direction: 'neutral', magnitude: 'low', explanation: '' },
    riskImpact: { direction: 'negative', magnitude: 'high', explanation: '' },
    capitalImpact: { direction: 'neutral', magnitude: 'low', explanation: '' },
    reviewTriggers: [
      {
        id: 'risk-trigger',
        label: 'Risk threshold crossed',
        triggerType: 'risk',
        threshold: -50,
        explanation: 'Loss moved beyond the configured review threshold.',
      },
    ],
    metadata: {
      executionAllowed: false,
      paperExecutionAllowed: false,
      rulesEvaluated: ['OBJ-CLOSE-LOSER'],
      rulesTriggered: ['OBJ-CLOSE-LOSER'],
    },
    ...overrides,
  };
}

function prioritized(overrides: Partial<PrioritizedObjective> = {}): PrioritizedObjective {
  return {
    objective: objective(),
    score: 61,
    tier: 'High',
    reasons: ['Recommendation: Reduce Risk', 'High confidence recommendation', 'Net Edge deteriorating rapidly'],
    ...overrides,
  };
}

describe('buildRecommendationExplanation', () => {
  it('separates confidence from priority and labels it deterministically', () => {
    const result = buildRecommendationExplanation(prioritized());

    expect(result.confidence).toEqual({ provenance: 'DECISION_SCORE', score: 92, label: 'Very High' });
  });

  it('marks Verify Pricing as a deterministic rule without fabricating measured confidence', () => {
    const result = buildRecommendationExplanation(prioritized({
      objective: objective({ type: 'MANAGE_POSITION', ruleId: 'OBJ-VERIFY-PRICING', confidence: 70 }),
    }));
    expect(result.confidence).toEqual({ provenance: 'RULE_CONSTANT', score: null, label: 'Deterministic' });
  });

  it('prefers quantified evidence and removes generic priority boilerplate', () => {
    const result = buildRecommendationExplanation(prioritized());

    expect(result.drivers.map((driver) => driver.label)).toEqual([
      'Net Edge',
      'Profit Captured',
      'Net Edge deteriorating rapidly',
    ]);
    expect(result.drivers.some((driver) => driver.label.startsWith('Recommendation:'))).toBe(false);
    expect(result.drivers.some((driver) => driver.label === 'High confidence recommendation')).toBe(false);
  });

  it('uses existing review-trigger explanations for why-now evidence', () => {
    const result = buildRecommendationExplanation(prioritized());

    expect(result.whyNow).toEqual(['Loss moved beyond the configured review threshold.']);
  });

  it('caps decision drivers and why-now entries to keep cards concise', () => {
    const manyEvidence = Array.from({ length: 7 }, (_, index) => ({
      id: `evidence-${index}`,
      label: `Evidence ${index}`,
      value: index,
      tone: 'negative' as const,
    }));
    const manyTriggers = Array.from({ length: 5 }, (_, index) => ({
      id: `trigger-${index}`,
      label: `Trigger ${index}`,
      triggerType: 'risk' as const,
      explanation: `Trigger explanation ${index}`,
    }));

    const result = buildRecommendationExplanation(
      prioritized({ objective: objective({ supportingEvidence: manyEvidence, reviewTriggers: manyTriggers }) }),
    );

    expect(result.drivers).toHaveLength(4);
    expect(result.whyNow).toHaveLength(3);
  });
});
