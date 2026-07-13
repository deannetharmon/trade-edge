// features/portfolio/intelligence/__tests__/PositionIntelligencePanel.test.tsx
//
// PI-0005: component-level coverage for the Position Intelligence panel.

import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { THEMES } from '@/lib/theme';
import { PositionIntelligencePanel } from '../PositionIntelligencePanel';
import type { PortfolioObjective, PortfolioRecommendation } from '@/lib/portfolio-intelligence';

function makeRecommendation(overrides: Partial<PortfolioRecommendation> = {}): PortfolioRecommendation {
  return {
    positionId: 'pos_amd',
    symbol: 'AMD',
    kind: 'earnings-risk',
    label: 'Earnings Risk',
    urgency: 'high',
    confidence: 86,
    primaryReason: 'Upcoming earnings before expiration (2026-07-20).',
    supportingReasons: ['Delta: Delta remains within policy.', 'Buffer: Strike buffer remains healthy.'],
    suggestedAction: 'Decide whether to close, reduce risk, or intentionally hold through earnings.',
    computedAt: '2026-07-12T00:00:00.000Z',
    ...overrides,
  };
}

function makeObjective(overrides: Partial<PortfolioObjective> = {}): PortfolioObjective {
  return {
    id: 'obj_1',
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
    subject: { type: 'position', id: 'pos_amd', symbol: 'AMD', label: 'AMD' },
    rationale: 'Decide whether to close, reduce risk, or hold through earnings.',
    supportingEvidence: [{ id: 'ev1', label: 'Earnings date', value: '2026-07-20', tone: 'warning', explanation: 'Falls before expiration.' }],
    concerns: [{ id: 'c1', label: 'Earnings approaching', severity: 'high', explanation: 'Event risk before expiration.' }],
    portfolioImpact: { direction: 'negative', magnitude: 'medium', explanation: 'n/a' },
    incomeImpact: { direction: 'neutral', magnitude: 'low', explanation: 'n/a' },
    riskImpact: { direction: 'negative', magnitude: 'medium', explanation: 'n/a' },
    capitalImpact: { direction: 'neutral', magnitude: 'low', explanation: 'n/a' },
    reviewTriggers: [{ id: 'review-before-earnings', label: 'Review before earnings', triggerType: 'earnings', threshold: '2026-07-20', explanation: 'Decide before the earnings date arrives.' }],
    metadata: { executionAllowed: false, paperExecutionAllowed: false, rulesEvaluated: [], rulesTriggered: [] },
    ...overrides,
  };
}

describe('PI-0005: PositionIntelligencePanel -- objective present', () => {
  it('renders Current Recommendation from recommendation.label', () => {
    render(<PositionIntelligencePanel recommendation={makeRecommendation()} objective={makeObjective()} lifecycleType="SPREAD" th={THEMES.dark} />);
    expect(screen.getByText('Earnings Risk')).toBeInTheDocument();
  });

  it('renders Why from the objective\'s rationale and supporting evidence', () => {
    render(<PositionIntelligencePanel recommendation={makeRecommendation()} objective={makeObjective()} lifecycleType="SPREAD" th={THEMES.dark} />);
    expect(screen.getByText('Decide whether to close, reduce risk, or hold through earnings.')).toBeInTheDocument();
    expect(screen.getByText('Earnings date')).toBeInTheDocument();
  });

  it('renders Current Concerns from the objective', () => {
    render(<PositionIntelligencePanel recommendation={makeRecommendation()} objective={makeObjective()} lifecycleType="SPREAD" th={THEMES.dark} />);
    expect(screen.getByText('Earnings approaching')).toBeInTheDocument();
  });

  it('renders review triggers as "What Would Change This Recommendation?"', () => {
    render(<PositionIntelligencePanel recommendation={makeRecommendation()} objective={makeObjective()} lifecycleType="SPREAD" th={THEMES.dark} />);
    const section = screen.getByText('What Would Change This Recommendation?').closest('div')!;
    expect(within(section).getByText('Review before earnings')).toBeInTheDocument();
  });

  it('renders Next Expected Lifecycle Event derived from kind/lifecycle', () => {
    render(<PositionIntelligencePanel recommendation={makeRecommendation()} objective={makeObjective()} lifecycleType="SPREAD" th={THEMES.dark} />);
    expect(screen.getByText('Earnings review approaching.')).toBeInTheDocument();
  });

  it('renders Available Management Choices with the preferred choice marked', () => {
    render(<PositionIntelligencePanel recommendation={makeRecommendation()} objective={makeObjective()} lifecycleType="SPREAD" th={THEMES.dark} />);
    expect(screen.getByText('Monitor (preferred)')).toBeInTheDocument();
  });
});

describe('PI-0005: PositionIntelligencePanel -- null objective (hold case)', () => {
  const holdRecommendation = makeRecommendation({
    kind: 'hold',
    label: 'Hold',
    primaryReason: 'Health score is 88; no primary action rule triggered.',
    supportingReasons: ['Delta: Delta remains within policy.'],
  });

  it('falls back to recommendation.primaryReason and supportingReasons for Why', () => {
    render(<PositionIntelligencePanel recommendation={holdRecommendation} objective={null} lifecycleType="SPREAD" th={THEMES.dark} />);
    expect(screen.getByText('Health score is 88; no primary action rule triggered.')).toBeInTheDocument();
    expect(screen.getByText(/Delta remains within policy/)).toBeInTheDocument();
  });

  it('shows "No current concerns." when there is no canonical objective', () => {
    render(<PositionIntelligencePanel recommendation={holdRecommendation} objective={null} lifecycleType="SPREAD" th={THEMES.dark} />);
    expect(screen.getByText('No current concerns.')).toBeInTheDocument();
  });

  it('falls back to the "next portfolio evaluation" review trigger', () => {
    render(<PositionIntelligencePanel recommendation={holdRecommendation} objective={null} lifecycleType="SPREAD" th={THEMES.dark} />);
    expect(screen.getByText('Next portfolio evaluation')).toBeInTheDocument();
  });
});

describe('PI-0005: does not duplicate Portfolio Intelligence logic', () => {
  it('does not import any Portfolio Intelligence evaluation function', async () => {
    const fs = await import('node:fs/promises');
    const text = await fs.readFile('features/portfolio/intelligence/PositionIntelligencePanel.tsx', 'utf-8');
    expect(text).not.toContain('evaluatePositionObjective(');
    expect(text).not.toContain('evaluatePortfolioObjectives(');
    expect(text).not.toContain('prioritizePortfolioObjectives(');
  });
});
