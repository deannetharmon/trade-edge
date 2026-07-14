// features/portfolio/intelligence/__tests__/PositionIntelligencePanel.test.tsx
//
// PI-0005: component-level coverage for the Position Intelligence panel.

import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { THEMES } from '@/lib/theme';
import { PositionIntelligencePanel } from '../PositionIntelligencePanel';
import type { ManagementIntentResult, PortfolioObjective, PortfolioRecommendation } from '@/lib/portfolio-intelligence';

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

function makeManagementIntent(overrides: Partial<ManagementIntentResult> = {}): ManagementIntentResult {
  const cutLosses = {
    intent: 'CUT_LOSSES' as const,
    label: 'Cut Losses',
    score: 112,
    reasons: ['Loss has reached the policy loss-stop threshold.'],
    contributions: [
      { id: 'material-loss', label: 'Material loss threshold breached', points: 100, explanation: 'Loss has reached the policy loss-stop threshold.', evidenceField: 'materialLoss' },
      { id: 'weak-health-loss', label: 'Weak health confirmation', points: 12, explanation: 'Loss is material and the health score is weak.', evidenceField: 'weakHealthLoss' },
    ],
    isWinner: true,
  };
  const reduceRisk = {
    intent: 'REDUCE_RISK' as const,
    label: 'Reduce Risk',
    score: 70,
    reasons: [],
    contributions: [
      { id: 'net-edge-decline', label: 'Net Edge declined from peak', points: 40, explanation: 'Net edge has declined 40% from its peak.', evidenceField: 'netEdgeDeclinePct' },
      { id: 'tight-buffer-reduce-risk', label: 'Tight strike buffer', points: 30, explanation: 'Strike buffer is tight or the position is in the money.', evidenceField: 'itmOrCriticalBuffer' },
    ],
    isWinner: false,
  };
  return {
    intent: 'CUT_LOSSES',
    label: 'Cut Losses',
    reasons: cutLosses.reasons,
    alternatives: [reduceRisk],
    candidates: [cutLosses, reduceRisk],
    winnerScore: 112,
    runnerUpIntent: 'REDUCE_RISK',
    runnerUpScore: 70,
    margin: 42,
    confidenceTier: 'High',
    ...overrides,
  };
}

describe('PI-0007A: Decision Scorecard (collapsed debug section)', () => {
  it('does not render the scorecard when recommendation.managementIntent is absent', () => {
    render(<PositionIntelligencePanel recommendation={makeRecommendation()} objective={makeObjective()} lifecycleType="SPREAD" th={THEMES.dark} />);
    expect(screen.queryByText('Decision Scorecard')).not.toBeInTheDocument();
  });

  it('renders a collapsed "Decision Scorecard" toggle when managementIntent is present', () => {
    const recommendation = makeRecommendation({ managementIntent: makeManagementIntent() });
    render(<PositionIntelligencePanel recommendation={recommendation} objective={makeObjective()} lifecycleType="SPREAD" th={THEMES.dark} />);
    const toggle = screen.getByRole('button', { name: 'Decision Scorecard' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // Collapsed: winner/margin/candidate detail is not yet in the DOM output.
    expect(screen.queryByText(/Margin:/)).not.toBeInTheDocument();
  });

  it('expands on click to show winner, confidence, margin, ranked candidates, and their contributions', () => {
    const recommendation = makeRecommendation({ managementIntent: makeManagementIntent() });
    render(<PositionIntelligencePanel recommendation={recommendation} objective={makeObjective()} lifecycleType="SPREAD" th={THEMES.dark} />);

    const toggle = screen.getByRole('button', { name: 'Decision Scorecard' });
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/Confidence:/)).toBeInTheDocument();
    expect(screen.getByText(/High/)).toBeInTheDocument();
    expect(screen.getByText(/Margin:/)).toBeInTheDocument();
    expect(screen.getByText(/42/)).toBeInTheDocument();
    expect(screen.getByText(/Cut Losses \(winner\)/)).toBeInTheDocument();
    expect(screen.getByText('Reduce Risk')).toBeInTheDocument();
    expect(screen.getByText(/Material loss threshold breached/)).toBeInTheDocument();
    expect(screen.getByText(/Net Edge declined from peak/)).toBeInTheDocument();
  });

  it('collapses again on a second click', () => {
    const recommendation = makeRecommendation({ managementIntent: makeManagementIntent() });
    render(<PositionIntelligencePanel recommendation={recommendation} objective={makeObjective()} lifecycleType="SPREAD" th={THEMES.dark} />);
    const toggle = screen.getByRole('button', { name: 'Decision Scorecard' });
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/Margin:/)).not.toBeInTheDocument();
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
