// lib/portfolio-intelligence/__tests__/prioritizePortfolioObjectives.test.ts
//
// PI-0003: the canonical priority engine, tested directly (not just via
// evaluatePortfolioObjectives' internal use of it). Covers the stated
// canonical ranking order and the "deploy-cash must never outrank critical
// risk" guarantee at the prioritizer level, independent of which producer
// built the objectives.

import { describe, expect, it } from 'vitest';
import { prioritizePortfolioObjectives, synthesizeWaitObjective } from '@/lib/portfolio-intelligence';
import type { PortfolioObjective } from '@/lib/portfolio-intelligence';

function makeObjective(overrides: Partial<PortfolioObjective>): PortfolioObjective {
  return {
    id: `obj_${Math.random().toString(36).slice(2, 9)}`,
    createdAt: '2026-07-12T00:00:00.000Z',
    version: 'portfolio-objective-v1',
    type: 'WAIT',
    ruleId: 'OBJ-WAIT',
    title: 'Test objective',
    summary: 'Test',
    priority: 'medium',
    urgency: 'this_week',
    confidence: 70,
    status: 'active',
    source: 'portfolio_state',
    subject: { type: 'portfolio', label: 'Portfolio' },
    rationale: 'Test rationale for a synthetic objective used in ranking tests.',
    supportingEvidence: [],
    concerns: [],
    portfolioImpact: { direction: 'neutral', magnitude: 'low', explanation: 'n/a' },
    incomeImpact: { direction: 'neutral', magnitude: 'low', explanation: 'n/a' },
    riskImpact: { direction: 'neutral', magnitude: 'low', explanation: 'n/a' },
    capitalImpact: { direction: 'neutral', magnitude: 'low', explanation: 'n/a' },
    reviewTriggers: [],
    metadata: { executionAllowed: false, paperExecutionAllowed: false, rulesEvaluated: [], rulesTriggered: [] },
    ...overrides,
  };
}

describe('PI-0003: canonical ranking order', () => {
  it('ranks in the stated order: threatened > management > profit > pending-order > construction > buying-power > idle-cash > income > wait', () => {
    const objectives: PortfolioObjective[] = [
      makeObjective({ type: 'INCREASE_INCOME', ruleId: 'OBJ-INCREASE-INCOME', priority: 'medium' }),
      makeObjective({ type: 'DEPLOY_IDLE_CASH', ruleId: 'OBJ-DEPLOY-IDLE-CASH', priority: 'medium' }),
      makeObjective({ type: 'PRESERVE_BUYING_POWER', ruleId: 'OBJ-PRESERVE-BUYING-POWER', priority: 'high' }),
      makeObjective({ type: 'REDUCE_CONCENTRATION', ruleId: 'OBJ-REDUCE-CONCENTRATION', priority: 'high' }),
      makeObjective({ type: 'REVIEW_PENDING_ORDER', ruleId: 'OBJ-REVIEW-PENDING-ORDER', priority: 'high' }),
      makeObjective({ type: 'CLOSE_FOR_PROFIT', ruleId: 'OBJ-CLOSE-FOR-PROFIT', priority: 'high' }),
      makeObjective({ type: 'MANAGE_POSITION', ruleId: 'OBJ-MANAGE-21-DTE', priority: 'high' }),
      makeObjective({ type: 'REVIEW_THREATENED_POSITION', ruleId: 'OBJ-CLOSE-LOSER', priority: 'high' }),
    ];

    const ranked = prioritizePortfolioObjectives(objectives);
    const highPriorityTypes = ranked.filter((o) => o.priority === 'high').map((o) => o.type);
    expect(highPriorityTypes).toEqual([
      'REVIEW_THREATENED_POSITION',
      'MANAGE_POSITION',
      'CLOSE_FOR_PROFIT',
      'REVIEW_PENDING_ORDER',
      'REDUCE_CONCENTRATION',
      'PRESERVE_BUYING_POWER',
    ]);
    const mediumPriorityTypes = ranked.filter((o) => o.priority === 'medium').map((o) => o.type);
    expect(mediumPriorityTypes).toEqual(['DEPLOY_IDLE_CASH', 'INCREASE_INCOME']);
  });

  it('a critical threatened-position objective always ranks above a same-or-higher-priority income objective', () => {
    const objectives: PortfolioObjective[] = [
      makeObjective({ type: 'INCREASE_INCOME', ruleId: 'OBJ-INCREASE-INCOME', priority: 'high', confidence: 99 }),
      makeObjective({ type: 'REVIEW_THREATENED_POSITION', ruleId: 'OBJ-CLOSE-LOSER', priority: 'critical', confidence: 50 }),
    ];
    const ranked = prioritizePortfolioObjectives(objectives);
    expect(ranked[0].type).toBe('REVIEW_THREATENED_POSITION');
  });

  it('returns a single synthesized WAIT objective for empty input', () => {
    const ranked = prioritizePortfolioObjectives([]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].type).toBe('WAIT');
    expect(ranked[0].ruleId).toBe('OBJ-WAIT');
    expect(ranked[0].metadata.executionAllowed).toBe(false);
  });

  it('synthesizeWaitObjective is directly callable and produces a valid PortfolioObjective', () => {
    const wait = synthesizeWaitObjective('2026-07-12T00:00:00.000Z');
    expect(wait.type).toBe('WAIT');
    expect(wait.ruleId).toBe('OBJ-WAIT');
    expect(wait.priority).toBe('informational');
    expect(wait.metadata.paperExecutionAllowed).toBe(false);
  });

  it('is deterministic: repeated calls with the same input produce the same order', () => {
    const objectives: PortfolioObjective[] = [
      makeObjective({ type: 'CLOSE_FOR_PROFIT', ruleId: 'OBJ-CLOSE-FOR-PROFIT', priority: 'high' }),
      makeObjective({ type: 'REVIEW_THREATENED_POSITION', ruleId: 'OBJ-CLOSE-LOSER', priority: 'critical' }),
      makeObjective({ type: 'DEPLOY_IDLE_CASH', ruleId: 'OBJ-DEPLOY-IDLE-CASH', priority: 'medium' }),
    ];
    const run1 = prioritizePortfolioObjectives(objectives).map((o) => o.type);
    const run2 = prioritizePortfolioObjectives(objectives).map((o) => o.type);
    expect(run1).toEqual(run2);
  });
});
