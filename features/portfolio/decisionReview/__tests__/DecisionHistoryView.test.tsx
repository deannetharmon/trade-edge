// features/portfolio/decisionReview/__tests__/DecisionHistoryView.test.tsx
//
// PI-0008C: Decision Outcome Tracking V1 -- Decision History view tests
// (ticket #6: listing + filtering, no charts/analytics).

import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { THEMES } from '@/lib/theme';
import { DecisionHistoryView } from '../DecisionHistoryView';
import { createDecisionReview, upsertDecisionReview } from '@/lib/decision-review';
import type { DecisionReview, DecisionReviewStore } from '@/lib/decision-review';
import type { PortfolioRecommendation } from '@/lib/portfolio-intelligence';

function makeRecommendation(overrides: Partial<PortfolioRecommendation> = {}): PortfolioRecommendation {
  return {
    positionId: 'pos_1', symbol: 'SOXL', kind: 'close-loser', label: 'Cut Losses',
    urgency: 'critical', confidence: 91, primaryReason: 'r', supportingReasons: [],
    suggestedAction: 'a', computedAt: '2026-07-20T00:00:00.000Z',
    ...overrides,
  };
}

function buildStore(): DecisionReviewStore {
  let store: DecisionReviewStore = {};

  const pending = createDecisionReview(
    { positionId: 'pos_1', symbol: 'SOXL', strategy: 'BPS', recommendation: makeRecommendation() },
    new Date('2026-07-01T00:00:00.000Z'),
  );
  store = upsertDecisionReview(store, { ...pending, id: 'r-pending' });

  const favorable = createDecisionReview(
    { positionId: 'pos_2', symbol: 'AMD', strategy: 'CSP', recommendation: makeRecommendation({ symbol: 'AMD', label: 'Take Profit' }), traderAction: 'FOLLOWED_RECOMMENDATION', outcomeStatus: 'FAVORABLE', realizedPnl: 150 },
    new Date('2026-07-05T00:00:00.000Z'),
  );
  store = upsertDecisionReview(store, { ...favorable, id: 'r-favorable' });

  const unfavorableNotFollowed = createDecisionReview(
    { positionId: 'pos_3', symbol: 'NVDA', strategy: 'CSP', recommendation: makeRecommendation({ symbol: 'NVDA', label: 'Hold Position' }), traderAction: 'CUT_LOSSES', outcomeStatus: 'UNFAVORABLE', realizedPnl: -420 },
    new Date('2026-07-10T00:00:00.000Z'),
  );
  store = upsertDecisionReview(store, { ...unfavorableNotFollowed, id: 'r-unfavorable' });

  return store;
}

describe('DecisionHistoryView: listing', () => {
  it('renders one row per review with symbol, recommendation, action, outcome, P/L, and date', () => {
    render(<DecisionHistoryView reviews={buildStore()} th={THEMES.dark} />);
    expect(screen.getByText('SOXL')).toBeInTheDocument();
    expect(screen.getByText('AMD')).toBeInTheDocument();
    expect(screen.getByText('NVDA')).toBeInTheDocument();
    expect(screen.getByText('Take Profit')).toBeInTheDocument();
    expect(screen.getByText('Followed Recommendation')).toBeInTheDocument();
    expect(screen.getAllByText('Favorable').length).toBeGreaterThan(0);
    expect(screen.getByText('+150.00')).toBeInTheDocument();
    expect(screen.getByText('-420.00')).toBeInTheDocument();
  });

  it('shows a placeholder message when there are no reviews', () => {
    render(<DecisionHistoryView reviews={{}} th={THEMES.dark} />);
    expect(screen.getByText(/no decision reviews match/i)).toBeInTheDocument();
  });

  it('renders a dash for reviews with no trader action or realized P/L yet', () => {
    render(<DecisionHistoryView reviews={buildStore()} th={THEMES.dark} />);
    const row = screen.getByText('SOXL').closest('tr')!;
    expect(within(row).getAllByText('—').length).toBeGreaterThanOrEqual(2); // action + P/L
  });
});

describe('DecisionHistoryView: filtering', () => {
  it('filters to Pending', () => {
    render(<DecisionHistoryView reviews={buildStore()} th={THEMES.dark} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pending' }));
    expect(screen.getByText('SOXL')).toBeInTheDocument();
    expect(screen.queryByText('AMD')).not.toBeInTheDocument();
    expect(screen.queryByText('NVDA')).not.toBeInTheDocument();
  });

  it('filters to Favorable', () => {
    render(<DecisionHistoryView reviews={buildStore()} th={THEMES.dark} />);
    fireEvent.click(screen.getByRole('button', { name: 'Favorable' }));
    expect(screen.getByText('AMD')).toBeInTheDocument();
    expect(screen.queryByText('SOXL')).not.toBeInTheDocument();
    expect(screen.queryByText('NVDA')).not.toBeInTheDocument();
  });

  it('filters to Unfavorable', () => {
    render(<DecisionHistoryView reviews={buildStore()} th={THEMES.dark} />);
    fireEvent.click(screen.getByRole('button', { name: 'Unfavorable' }));
    expect(screen.getByText('NVDA')).toBeInTheDocument();
    expect(screen.queryByText('SOXL')).not.toBeInTheDocument();
    expect(screen.queryByText('AMD')).not.toBeInTheDocument();
  });

  it('filters to Followed', () => {
    render(<DecisionHistoryView reviews={buildStore()} th={THEMES.dark} />);
    fireEvent.click(screen.getByRole('button', { name: 'Followed' }));
    expect(screen.getByText('AMD')).toBeInTheDocument();
    expect(screen.queryByText('SOXL')).not.toBeInTheDocument();
    expect(screen.queryByText('NVDA')).not.toBeInTheDocument();
  });

  it('filters to Did Not Follow', () => {
    render(<DecisionHistoryView reviews={buildStore()} th={THEMES.dark} />);
    fireEvent.click(screen.getByRole('button', { name: 'Did Not Follow' }));
    expect(screen.getByText('NVDA')).toBeInTheDocument();
    expect(screen.queryByText('SOXL')).not.toBeInTheDocument();
    expect(screen.queryByText('AMD')).not.toBeInTheDocument();
  });

  it('All shows every review again', () => {
    render(<DecisionHistoryView reviews={buildStore()} th={THEMES.dark} />);
    fireEvent.click(screen.getByRole('button', { name: 'Unfavorable' }));
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText('SOXL')).toBeInTheDocument();
    expect(screen.getByText('AMD')).toBeInTheDocument();
    expect(screen.getByText('NVDA')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// PI-0008D: Decision Review Follow-Up Reminder
// ---------------------------------------------------------------------------

describe('DecisionHistoryView: Needs Follow-Up (PI-0008D)', () => {
  // buildStore()'s only Pending review is pos_1/SOXL; the other two already
  // have a completed outcome and must never be flagged regardless of
  // open-position state.
  it('marks a Pending review whose position is not open as Needs Follow-Up', () => {
    render(<DecisionHistoryView reviews={buildStore()} openPositionIds={['pos_2', 'pos_3']} th={THEMES.dark} />);
    const soxlRow = screen.getByText('SOXL').closest('tr')!;
    expect(within(soxlRow).getByText('Needs Follow-Up')).toBeInTheDocument();
  });

  it('does not mark a Pending review whose position is still open', () => {
    render(<DecisionHistoryView reviews={buildStore()} openPositionIds={['pos_1', 'pos_2', 'pos_3']} th={THEMES.dark} />);
    const soxlRow = screen.getByText('SOXL').closest('tr')!;
    expect(within(soxlRow).queryByText('Needs Follow-Up')).not.toBeInTheDocument();
  });

  it('never marks completed (non-Pending) reviews, even when their position is closed', () => {
    render(<DecisionHistoryView reviews={buildStore()} openPositionIds={[]} th={THEMES.dark} />);
    const amdRow = screen.getByText('AMD').closest('tr')!;
    const nvdaRow = screen.getByText('NVDA').closest('tr')!;
    expect(within(amdRow).queryByText('Needs Follow-Up')).not.toBeInTheDocument();
    expect(within(nvdaRow).queryByText('Needs Follow-Up')).not.toBeInTheDocument();
  });

  it('the Needs Follow-Up filter shows only flagged records', () => {
    render(<DecisionHistoryView reviews={buildStore()} openPositionIds={['pos_2', 'pos_3']} th={THEMES.dark} />);
    fireEvent.click(screen.getByRole('button', { name: 'Needs Follow-Up' }));
    expect(screen.getByText('SOXL')).toBeInTheDocument();
    expect(screen.queryByText('AMD')).not.toBeInTheDocument();
    expect(screen.queryByText('NVDA')).not.toBeInTheDocument();
  });

  it('the Needs Follow-Up filter shows the empty-state message when nothing needs follow-up', () => {
    render(<DecisionHistoryView reviews={buildStore()} openPositionIds={['pos_1', 'pos_2', 'pos_3']} th={THEMES.dark} />);
    fireEvent.click(screen.getByRole('button', { name: 'Needs Follow-Up' }));
    expect(screen.getByText(/no decision reviews match/i)).toBeInTheDocument();
  });

  it('treats every Pending review as needing follow-up when openPositionIds is omitted entirely', () => {
    render(<DecisionHistoryView reviews={buildStore()} th={THEMES.dark} />);
    const soxlRow = screen.getByText('SOXL').closest('tr')!;
    expect(within(soxlRow).getByText('Needs Follow-Up')).toBeInTheDocument();
  });
});
