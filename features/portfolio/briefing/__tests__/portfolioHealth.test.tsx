// features/portfolio/briefing/__tests__/portfolioHealth.test.tsx
//
// PI-0004D: pure-logic coverage for Portfolio Health derivation.

import { describe, expect, it } from 'vitest';
import { derivePortfolioHealth } from '../portfolioHealth';
import type { PortfolioObjective } from '@/lib/portfolio-intelligence';

function makeObjective(overrides: Partial<PortfolioObjective> = {}): PortfolioObjective {
  return {
    id: `obj_${Math.random().toString(36).slice(2, 9)}`,
    createdAt: '2026-07-12T00:00:00.000Z',
    version: 'portfolio-objective-v1',
    type: 'REVIEW_THREATENED_POSITION',
    ruleId: 'OBJ-EARNINGS-RISK',
    title: 'Earnings Risk: AMD',
    summary: 'Upcoming earnings before expiration.',
    priority: 'high',
    urgency: 'today',
    actionability: 'ACTION_NEEDED',
    confidence: 86,
    status: 'active',
    source: 'position',
    subject: { type: 'position', id: 'pos_amd', symbol: 'AMD', label: 'AMD BPS position' },
    rationale: 'Decide whether to close, reduce risk, or hold through earnings.',
    supportingEvidence: [],
    concerns: [],
    portfolioImpact: { direction: 'negative', magnitude: 'medium', explanation: 'n/a' },
    incomeImpact: { direction: 'neutral', magnitude: 'low', explanation: 'n/a' },
    riskImpact: { direction: 'negative', magnitude: 'medium', explanation: 'n/a' },
    capitalImpact: { direction: 'neutral', magnitude: 'low', explanation: 'n/a' },
    reviewTriggers: [],
    metadata: { executionAllowed: false, paperExecutionAllowed: false, rulesEvaluated: [], rulesTriggered: [] },
    ...overrides,
  };
}

function makeWait(): PortfolioObjective {
  return makeObjective({
    type: 'WAIT', ruleId: 'OBJ-WAIT', title: 'No action required', priority: 'informational',
    urgency: 'none', actionability: 'MONITOR', subject: { type: 'portfolio', label: 'Portfolio' },
  });
}

describe('PI-0004D: derivePortfolioHealth', () => {
  it('returns Healthy for null objectives', () => {
    expect(derivePortfolioHealth(null).level).toBe('healthy');
  });

  it('returns Healthy for an empty list', () => {
    expect(derivePortfolioHealth([]).level).toBe('healthy');
  });

  it('returns Healthy for a WAIT-only list', () => {
    expect(derivePortfolioHealth([makeWait()]).level).toBe('healthy');
  });

  it('returns Action Required when the top objective is critical priority', () => {
    const status = derivePortfolioHealth([makeObjective({ priority: 'critical', actionability: 'ACTION_NEEDED' })]);
    expect(status.level).toBe('action');
    expect(status.emoji).toBe('\u{1F534}');
  });

  it('returns Action Required when the top objective has CRITICAL actionability even if priority is lower', () => {
    const status = derivePortfolioHealth([makeObjective({ priority: 'medium', actionability: 'CRITICAL' })]);
    expect(status.level).toBe('action');
  });

  it('returns Needs Attention when the top objective is high priority', () => {
    const status = derivePortfolioHealth([makeObjective({ priority: 'high', actionability: 'ACTION_NEEDED' })]);
    expect(status.level).toBe('attention');
    expect(status.emoji).toBe('\u{1F7E1}');
  });

  it('returns Healthy when the top objective is only medium/low priority', () => {
    const status = derivePortfolioHealth([makeObjective({ priority: 'medium', actionability: 'REVIEW_SOON' })]);
    expect(status.level).toBe('healthy');
  });

  it('derives status from only the top-ranked (first) objective, ignoring the rest', () => {
    const status = derivePortfolioHealth([
      makeObjective({ priority: 'critical', actionability: 'CRITICAL' }),
      makeObjective({ priority: 'low', actionability: 'MONITOR' }),
    ]);
    expect(status.level).toBe('action');
  });
});
