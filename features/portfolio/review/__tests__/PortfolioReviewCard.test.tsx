// features/portfolio/review/__tests__/PortfolioReviewCard.test.tsx
//
// PI-0012A: component-level coverage for the Portfolio Review card --
// rendering of a fully-populated snapshot, and clean rendering of the
// empty-portfolio / not-yet-loaded states.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { THEMES } from '@/lib/theme';
import { PortfolioReviewCard } from '../PortfolioReviewCard';
import type { PortfolioReviewSnapshot } from '@/lib/portfolioReview';
import type { PortfolioObjective, ObjectiveImpact } from '@/lib/portfolio-intelligence';

const NEUTRAL_IMPACT: ObjectiveImpact = { direction: 'neutral', magnitude: 'low', explanation: '' };

function makeObjective(overrides: Partial<PortfolioObjective> = {}): PortfolioObjective {
  return {
    id: `obj_${Math.random().toString(36).slice(2, 9)}`,
    createdAt: '2026-07-16T00:00:00.000Z',
    version: 'portfolio-objective-v1',
    type: 'REDUCE_CONCENTRATION',
    ruleId: 'OBJ-REDUCE-CONCENTRATION',
    title: 'Reduce Concentration: AAPL',
    summary: 'AAPL exposure is above the configured limit.',
    priority: 'medium',
    urgency: 'this_week',
    actionability: 'REVIEW_SOON',
    confidence: 85,
    status: 'active',
    source: 'portfolio_state',
    subject: { type: 'symbol', symbol: 'AAPL', label: 'AAPL exposure' },
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

function makeSnapshot(overrides: Partial<PortfolioReviewSnapshot['currentState']> = {}, composition: Partial<PortfolioReviewSnapshot['composition']> = {}): PortfolioReviewSnapshot {
  return {
    generatedAt: '2026-07-16T00:00:00.000Z',
    currentState: {
      health: { score: 82, status: 'Healthy', positiveContributors: [{ id: 'immediateActions', label: 'No immediate actions pending' }], negativeContributors: [] },
      topRisks: [],
      concentrationConcerns: [],
      capitalConcerns: [],
      incomeConcern: null,
      ...overrides,
    },
    composition: {
      positionCount: 0,
      byStrategy: {},
      symbolConcentrationPct: {},
      maxSymbolConcentrationPct: null,
      wheelManagedFraction: null,
      ...composition,
    },
  };
}

describe('PI-0012A: PortfolioReviewCard', () => {
  it('renders nothing when review is null and not loading', () => {
    const { container } = render(<PortfolioReviewCard review={null} loading={false} th={THEMES.dark} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a loading state when review is null and loading', () => {
    render(<PortfolioReviewCard review={null} loading={true} th={THEMES.dark} />);
    expect(screen.getByText(/Loading Portfolio Review/)).toBeInTheDocument();
  });

  it('renders Portfolio Health, Top Risks, Portfolio Composition, and Capital & Income sections in order', () => {
    const snapshot = makeSnapshot();
    render(<PortfolioReviewCard review={snapshot} loading={false} th={THEMES.dark} />);

    const container = screen.getByLabelText('Portfolio Review');
    const sectionLabels = Array.from(container.querySelectorAll('[aria-label]')).map((el) => el.getAttribute('aria-label'));
    expect(sectionLabels).toEqual(['Portfolio Health', 'Top Risks', 'Portfolio Composition', 'Capital & Income']);
  });

  it('renders the Portfolio Health score and status verbatim from the snapshot', () => {
    const snapshot = makeSnapshot({ health: { score: 44, status: 'Action Required', positiveContributors: [], negativeContributors: [{ id: 'x', label: 'Idle cash elevated' }] } });
    render(<PortfolioReviewCard review={snapshot} loading={false} th={THEMES.dark} />);

    expect(screen.getByText('44')).toBeInTheDocument();
    expect(screen.getByText('Action Required')).toBeInTheDocument();
    expect(screen.getByText('Idle cash elevated', { exact: false })).toBeInTheDocument();
  });

  it('renders composition stats and strategy counts for a populated portfolio', () => {
    const snapshot = makeSnapshot(
      { concentrationConcerns: [makeObjective()] },
      { positionCount: 5, byStrategy: { BPS: 3, CSP: 2 }, maxSymbolConcentrationPct: 18.2, wheelManagedFraction: 0.4 },
    );
    render(<PortfolioReviewCard review={snapshot} loading={false} th={THEMES.dark} />);

    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('18.2%')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getByText('Reduce Concentration: AAPL')).toBeInTheDocument();
  });

  it('renders clean empty states for a portfolio with no positions and no concerns', () => {
    const snapshot = makeSnapshot();
    render(<PortfolioReviewCard review={snapshot} loading={false} th={THEMES.dark} />);

    expect(screen.getByText('No open positions yet.')).toBeInTheDocument();
    expect(screen.getByText('No elevated risks right now.')).toBeInTheDocument();
    expect(screen.getByText('No buying power, idle cash, or income concerns right now.')).toBeInTheDocument();
    // No NaN/undefined ever rendered as text.
    expect(container_hasNoNaN(screen)).toBe(true);
  });
});

// Guards against a regression where a missing numeric value renders the
// literal string "NaN" or "undefined" instead of a clean fallback like "N/A".
function container_hasNoNaN(screen: { getByLabelText: (label: string) => HTMLElement }): boolean {
  const container = screen.getByLabelText('Portfolio Review');
  const text = container.textContent ?? '';
  return !text.includes('NaN') && !text.includes('undefined');
}
