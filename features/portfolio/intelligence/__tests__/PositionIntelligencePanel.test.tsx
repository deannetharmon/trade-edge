// features/portfolio/intelligence/__tests__/PositionIntelligencePanel.test.tsx
//
// PI-0005: component-level coverage for the Position Intelligence panel.

import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

describe('UX Polish: Suggested Action card', () => {
  it('elevates label, suggested action, confidence, and urgency onto the top card', () => {
    render(<PositionIntelligencePanel recommendation={makeRecommendation()} objective={makeObjective()} lifecycleType="SPREAD" th={THEMES.dark} />);
    expect(screen.getByText('Suggested Action')).toBeInTheDocument();
    expect(screen.getByText('Earnings Risk')).toBeInTheDocument();
    expect(screen.getByText('Decide whether to close, reduce risk, or intentionally hold through earnings.')).toBeInTheDocument();
    expect(screen.getByText('Rule strength: Deterministic')).toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument();
  });

  it('surfaces the confidence tier when managementIntent is present', () => {
    const recommendation = makeRecommendation({ managementIntent: makeManagementIntent() });
    render(<PositionIntelligencePanel recommendation={recommendation} objective={makeObjective()} lifecycleType="SPREAD" th={THEMES.dark} />);
    expect(screen.getByText('Rule strength: High')).toBeInTheDocument();
  });

  it('surfaces top supporting evidence and remaining opportunity as compact metrics', () => {
    render(
      <PositionIntelligencePanel
        recommendation={makeRecommendation()}
        objective={makeObjective()}
        lifecycleType="SPREAD"
        remainingOpportunity={{ opportunityCapturedPct: 30, remainingOpportunityPct: 38, reasons: [] }}
        th={THEMES.dark}
      />,
    );
    expect(screen.getByText('38% opportunity remaining')).toBeInTheDocument();
  });
});

describe('PI-0005: PositionIntelligencePanel -- objective present', () => {
  it('renders Why from the objective\'s rationale and supporting evidence', () => {
    render(<PositionIntelligencePanel recommendation={makeRecommendation()} objective={makeObjective()} lifecycleType="SPREAD" th={THEMES.dark} />);
    expect(screen.getByText('Decide whether to close, reduce risk, or hold through earnings.')).toBeInTheDocument();
    // "Earnings date" is also surfaced as a compact metric on the Suggested
    // Action card above (see UX Polish describe block), so this is scoped to
    // the Why section specifically rather than a page-wide getByText.
    const whySection = screen.getByText('Why').closest('div')!;
    expect(within(whySection).getByText('Earnings date')).toBeInTheDocument();
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

describe('UX Polish: Decision Scorecard hidden pending redesign', () => {
  // The scorecard component and its accordion/contributions rendering are
  // unchanged (see DecisionScorecard in PositionIntelligencePanel.tsx) --
  // only gated off at the render layer via SHOW_DECISION_SCORECARD, so it
  // can come back in one line. No standalone unit test remains for its
  // internal accordion behavior while it's hidden; re-add if it's
  // re-enabled with a real design pass.
  it('does not render even when recommendation.managementIntent is present', () => {
    const recommendation = makeRecommendation({ managementIntent: makeManagementIntent() });
    render(<PositionIntelligencePanel recommendation={recommendation} objective={makeObjective()} lifecycleType="SPREAD" th={THEMES.dark} />);
    expect(screen.queryByText('Decision Scorecard')).not.toBeInTheDocument();
  });
});

describe('UX Polish: Decision Review hidden pending redesign', () => {
  it('does not render even when onSaveDecisionReview is provided', () => {
    render(
      <PositionIntelligencePanel
        recommendation={makeRecommendation()}
        objective={makeObjective()}
        lifecycleType="SPREAD"
        strategy="CSP"
        decisionReview={null}
        onSaveDecisionReview={() => {}}
        th={THEMES.dark}
      />,
    );
    expect(screen.queryByText('Decision Review')).not.toBeInTheDocument();
  });
});

describe('PI-0008A: Remaining Opportunity section', () => {
  it('does not render when remainingOpportunity is absent', () => {
    render(<PositionIntelligencePanel recommendation={makeRecommendation()} objective={makeObjective()} lifecycleType="SPREAD" th={THEMES.dark} />);
    expect(screen.queryByText('Remaining Opportunity')).not.toBeInTheDocument();
  });

  it('does not render when remainingOpportunityPct is null (no credit basis)', () => {
    render(
      <PositionIntelligencePanel
        recommendation={makeRecommendation()}
        objective={makeObjective()}
        lifecycleType="SPREAD"
        remainingOpportunity={{ opportunityCapturedPct: null, remainingOpportunityPct: null, reasons: ['No credit basis is available to measure remaining opportunity.'] }}
        th={THEMES.dark}
      />,
    );
    expect(screen.queryByText('Remaining Opportunity')).not.toBeInTheDocument();
  });

  it('renders both percentages and reasons when present', () => {
    render(
      <PositionIntelligencePanel
        recommendation={makeRecommendation()}
        objective={makeObjective()}
        lifecycleType="SPREAD"
        remainingOpportunity={{
          opportunityCapturedPct: 30,
          remainingOpportunityPct: 38,
          reasons: ['Only 15 DTE remain, inside the 21-day management window.'],
        }}
        th={THEMES.dark}
      />,
    );
    expect(screen.getByText('Remaining Opportunity')).toBeInTheDocument();
    expect(screen.getByText('38% remaining')).toBeInTheDocument();
    expect(screen.getByText('30% captured')).toBeInTheDocument();
    expect(screen.getByText(/Only 15 DTE remain/)).toBeInTheDocument();
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
