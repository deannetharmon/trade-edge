// features/portfolio/briefing/__tests__/suggestedFocus.test.tsx
//
// PI-0004D: pure-logic coverage for Suggested Focus derivation.

import { describe, expect, it } from 'vitest';
import { deriveSuggestedFocus } from '../suggestedFocus';
import type { PortfolioObjective } from '@/lib/portfolio-intelligence';

function makeObjective(overrides: Partial<PortfolioObjective> = {}): PortfolioObjective {
  return {
    id: `obj_${Math.random().toString(36).slice(2, 9)}`,
    createdAt: '2026-07-12T00:00:00.000Z',
    version: 'portfolio-objective-v1',
    type: 'REVIEW_THREATENED_POSITION',
    ruleId: 'OBJ-EARNINGS-RISK',
    title: 'Earnings Risk: AMD',
    summary: 'Review AMD before earnings later this week.',
    priority: 'high',
    urgency: 'today',
    actionability: 'ACTION_NEEDED',
    confidence: 86,
    status: 'active',
    source: 'position',
    subject: { type: 'position', id: 'pos_amd', symbol: 'AMD', label: 'AMD BPS position' },
    rationale: 'rationale',
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

describe('PI-0004D: deriveSuggestedFocus', () => {
  it('returns "No action required today." for null objectives', () => {
    expect(deriveSuggestedFocus(null)).toBe('No action required today.');
  });

  it('returns "No action required today." for a WAIT-only list', () => {
    expect(deriveSuggestedFocus([makeWait()])).toBe('No action required today.');
  });

  it('uses the top objective\'s subject symbol and summary when present', () => {
    expect(deriveSuggestedFocus([makeObjective()])).toBe('AMD: Review AMD before earnings later this week.');
  });

  it('falls back to the subject label when no symbol is present', () => {
    const objective = makeObjective({ subject: { type: 'portfolio', label: 'Portfolio concentration' } });
    expect(deriveSuggestedFocus([objective])).toBe('Portfolio concentration: Review AMD before earnings later this week.');
  });

  it('only reads the top-ranked (first) objective', () => {
    const top = makeObjective({ subject: { type: 'position', id: 'pos_1', symbol: 'NVDA', label: 'NVDA' }, summary: 'Harvest NVDA if premium reaches target.' });
    const second = makeObjective({ subject: { type: 'position', id: 'pos_2', symbol: 'FAST', label: 'FAST' }, summary: 'Harvest FAST if premium reaches target.' });
    expect(deriveSuggestedFocus([top, second])).toBe('NVDA: Harvest NVDA if premium reaches target.');
  });
});
