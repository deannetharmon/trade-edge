// features/portfolio/positions/__tests__/PositionCompositionCard.test.tsx
//
// WA-0002: component-level coverage for the extracted Portfolio Composition
// card -- seeded from PortfolioReviewCard.test.tsx's own composition
// assertions (PI-0012A), since this component is a direct extraction of
// that rendering logic, not a reimplementation.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { THEMES } from '@/lib/theme';
import { PositionCompositionCard } from '../PositionCompositionCard';
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
      health: { score: 82, status: 'Healthy', positiveContributors: [], negativeContributors: [] },
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

describe('WA-0002: PositionCompositionCard', () => {
  it('renders nothing when review is null and not loading', () => {
    const { container } = render(<PositionCompositionCard review={null} loading={false} th={THEMES.dark} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a loading state when review is null and loading', () => {
    render(<PositionCompositionCard review={null} loading={true} th={THEMES.dark} />);
    expect(screen.getByText(/Loading Portfolio Composition/)).toBeInTheDocument();
  });

  it('renders a clean empty state for a portfolio with no positions', () => {
    const snapshot = makeSnapshot();
    render(<PositionCompositionCard review={snapshot} loading={false} th={THEMES.dark} />);
    expect(screen.getByText('No open positions yet.')).toBeInTheDocument();
  });

  it('renders composition stats and strategy counts for a populated portfolio', () => {
    const snapshot = makeSnapshot(
      {},
      { positionCount: 5, byStrategy: { BPS: 3, CSP: 2 }, maxSymbolConcentrationPct: 18.2, wheelManagedFraction: 0.4 },
    );
    render(<PositionCompositionCard review={snapshot} loading={false} th={THEMES.dark} />);

    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('18.2%')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
    // "2" appears twice: the Strategies stat (2 distinct strategies) and the
    // CSP strategy-breakdown count -- both are correct, not a duplicate bug.
    expect(screen.getAllByText('2').length).toBe(2);
    expect(screen.getByText('BPS')).toBeInTheDocument();
    expect(screen.getByText('CSP')).toBeInTheDocument();
  });

  it('never renders concentrationConcerns -- portfolio-wide risk is out of scope for this card', () => {
    const snapshot = makeSnapshot(
      { concentrationConcerns: [makeObjective()] },
      { positionCount: 5, byStrategy: { BPS: 5 } },
    );
    render(<PositionCompositionCard review={snapshot} loading={false} th={THEMES.dark} />);
    expect(screen.queryByText('Reduce Concentration: AAPL')).not.toBeInTheDocument();
  });

  it('never renders Portfolio Health, Top Risks, or Capital & Income sections', () => {
    const snapshot = makeSnapshot();
    render(<PositionCompositionCard review={snapshot} loading={false} th={THEMES.dark} />);
    expect(screen.queryByLabelText('Portfolio Health')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Top Risks')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Capital & Income')).not.toBeInTheDocument();
  });

  it('renders no NaN/undefined values when fields are missing', () => {
    const snapshot = makeSnapshot({}, { positionCount: 3 });
    render(<PositionCompositionCard review={snapshot} loading={false} th={THEMES.dark} />);
    const container = screen.getByLabelText('Portfolio Composition');
    const text = container.textContent ?? '';
    expect(text.includes('NaN')).toBe(false);
    expect(text.includes('undefined')).toBe(false);
  });
});
