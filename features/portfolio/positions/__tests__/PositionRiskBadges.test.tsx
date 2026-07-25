// features/portfolio/positions/__tests__/PositionRiskBadges.test.tsx
//
// WA-0002: coverage for the five required cases -- null objective, neither
// predicate, assignment only, earnings only, and both -- verifying the
// component reads pos.portfolioObjective directly with no lookup/join.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { THEMES } from '@/lib/theme';
import { PositionRiskBadges } from '../PositionRiskBadges';
import type { PortfolioObjective, ObjectiveImpact, PortfolioObjectiveReviewTrigger } from '@/lib/portfolio-intelligence';

const NEUTRAL_IMPACT: ObjectiveImpact = { direction: 'neutral', magnitude: 'low', explanation: '' };

function makeObjective(overrides: Partial<PortfolioObjective> = {}): PortfolioObjective {
  return {
    id: `obj_${Math.random().toString(36).slice(2, 9)}`,
    createdAt: '2026-07-16T00:00:00.000Z',
    version: 'portfolio-objective-v1',
    type: 'MANAGE_POSITION',
    ruleId: 'OBJ-MANAGE-21-DTE',
    title: 'Manage MSFT BPS',
    summary: 'MSFT BPS reached the 21 DTE management window.',
    priority: 'medium',
    urgency: 'this_week',
    actionability: 'REVIEW_SOON',
    confidence: 85,
    status: 'active',
    source: 'position',
    subject: { type: 'position', id: 'pos_1', symbol: 'MSFT', label: 'MSFT BPS' },
    rationale: 'rationale',
    supportingEvidence: [],
    concerns: [],
    portfolioImpact: NEUTRAL_IMPACT,
    incomeImpact: NEUTRAL_IMPACT,
    riskImpact: NEUTRAL_IMPACT,
    capitalImpact: NEUTRAL_IMPACT,
    reviewTriggers: [],
    metadata: { executionAllowed: false, paperExecutionAllowed: false, rulesEvaluated: [], rulesTriggered: [] },
    ...overrides,
  };
}

const EARNINGS_TRIGGER: PortfolioObjectiveReviewTrigger = {
  id: 'review-before-earnings',
  label: 'Review before earnings',
  triggerType: 'earnings',
  explanation: 'Re-evaluate ahead of the next earnings date.',
};

describe('WA-0002: PositionRiskBadges', () => {
  it('renders nothing for a null objective', () => {
    const { container } = render(<PositionRiskBadges objective={null} th={THEMES.dark} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when neither predicate matches', () => {
    const objective = makeObjective({ ruleId: 'OBJ-CLOSE-FOR-PROFIT', reviewTriggers: [] });
    const { container } = render(<PositionRiskBadges objective={objective} th={THEMES.dark} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders only the Assignment Risk badge when ruleId is OBJ-ASSIGNMENT-RISK', () => {
    const objective = makeObjective({ ruleId: 'OBJ-ASSIGNMENT-RISK', reviewTriggers: [] });
    render(<PositionRiskBadges objective={objective} th={THEMES.dark} />);

    expect(screen.getByText('Assignment Risk', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText('Earnings Risk', { exact: false })).not.toBeInTheDocument();
  });

  it('renders only the Earnings Risk badge when an earnings review trigger is present', () => {
    const objective = makeObjective({ ruleId: 'OBJ-MANAGE-21-DTE', reviewTriggers: [EARNINGS_TRIGGER] });
    render(<PositionRiskBadges objective={objective} th={THEMES.dark} />);

    expect(screen.getByText('Earnings Risk', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText('Assignment Risk', { exact: false })).not.toBeInTheDocument();
  });

  it('renders both badges when both conditions are true on the same objective', () => {
    const objective = makeObjective({ ruleId: 'OBJ-ASSIGNMENT-RISK', reviewTriggers: [EARNINGS_TRIGGER] });
    render(<PositionRiskBadges objective={objective} th={THEMES.dark} />);

    expect(screen.getByText('Assignment Risk', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Earnings Risk', { exact: false })).toBeInTheDocument();
  });

  it('never renders a badge for concentration/capital/immediate-attention-only objectives', () => {
    const objective = makeObjective({ ruleId: 'OBJ-REDUCE-CONCENTRATION', reviewTriggers: [] });
    const { container } = render(<PositionRiskBadges objective={objective} th={THEMES.dark} />);
    expect(container).toBeEmptyDOMElement();
  });
});
