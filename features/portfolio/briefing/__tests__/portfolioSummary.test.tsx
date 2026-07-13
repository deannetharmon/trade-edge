// features/portfolio/briefing/__tests__/portfolioSummary.test.tsx
//
// PI-0004D: pure-logic coverage for Portfolio Summary derivation.

import { describe, expect, it } from 'vitest';
import { derivePortfolioSummary } from '../portfolioSummary';
import type { PortfolioObjective, PortfolioObjectiveType } from '@/lib/portfolio-intelligence';

function makeObjective(type: PortfolioObjectiveType, overrides: Partial<PortfolioObjective> = {}): PortfolioObjective {
  return {
    id: `obj_${Math.random().toString(36).slice(2, 9)}`,
    createdAt: '2026-07-12T00:00:00.000Z',
    version: 'portfolio-objective-v1',
    type,
    ruleId: 'OBJ-WATCH-POSITION',
    title: `${type} objective`,
    summary: 'summary',
    priority: 'medium',
    urgency: 'this_week',
    actionability: 'REVIEW_SOON',
    confidence: 70,
    status: 'active',
    source: 'position',
    subject: { type: 'position', id: 'pos_1', symbol: 'AMD', label: 'AMD' },
    rationale: 'rationale',
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

function makeWait(): PortfolioObjective {
  return makeObjective('WAIT', {
    ruleId: 'OBJ-WAIT', title: 'No action required', priority: 'informational',
    urgency: 'none', actionability: 'MONITOR', subject: { type: 'portfolio', label: 'Portfolio' },
  });
}

describe('PI-0004D: derivePortfolioSummary', () => {
  it('returns the all-healthy line for null objectives', () => {
    expect(derivePortfolioSummary(null)).toEqual(['Portfolio remains healthy.']);
  });

  it('returns the all-healthy line for a WAIT-only list', () => {
    expect(derivePortfolioSummary([makeWait()])).toEqual(['Portfolio remains healthy.']);
  });

  it('reports no concerns across all four checks when only unrelated objective types are present', () => {
    const lines = derivePortfolioSummary([makeObjective('MANAGE_POSITION')]);
    expect(lines).toEqual([
      'No threatened positions.',
      'No concentration concerns.',
      'Buying power remains healthy.',
      'Income positions remain within policy.',
    ]);
  });

  it('reports threatened position count when REVIEW_THREATENED_POSITION objectives are present', () => {
    const lines = derivePortfolioSummary([
      makeObjective('REVIEW_THREATENED_POSITION'),
      makeObjective('REVIEW_THREATENED_POSITION'),
    ]);
    expect(lines[0]).toBe('2 threatened positions need review.');
  });

  it('uses singular phrasing for exactly one threatened position', () => {
    const lines = derivePortfolioSummary([makeObjective('REVIEW_THREATENED_POSITION')]);
    expect(lines[0]).toBe('1 threatened position needs review.');
  });

  it('reports a concentration concern when REDUCE_CONCENTRATION is present', () => {
    const lines = derivePortfolioSummary([makeObjective('REDUCE_CONCENTRATION')]);
    expect(lines[1]).toBe('Concentration above policy in one or more symbols.');
  });

  it('reports a buying power concern when PRESERVE_BUYING_POWER is present', () => {
    const lines = derivePortfolioSummary([makeObjective('PRESERVE_BUYING_POWER')]);
    expect(lines[2]).toBe('Buying power utilization above policy.');
  });

  it('reports an income concern when INCREASE_INCOME is present', () => {
    const lines = derivePortfolioSummary([makeObjective('INCREASE_INCOME')]);
    expect(lines[3]).toBe('Income production below target.');
  });
});
