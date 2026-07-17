// features/portfolio/decisionReview/__tests__/DecisionReviewSection.test.tsx
//
// PI-0008C: Decision Outcome Tracking V1 -- component-level coverage for the
// Position Intelligence "Decision Review" section.

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { THEMES } from '@/lib/theme';
import { DecisionReviewSection } from '../DecisionReviewSection';
import { createDecisionReview } from '@/lib/decision-review';
import type { DecisionReview } from '@/lib/decision-review';
import type { PortfolioRecommendation } from '@/lib/portfolio-intelligence';

const NOW = new Date('2026-07-20T12:00:00.000Z');

function makeRecommendation(overrides: Partial<PortfolioRecommendation> = {}): PortfolioRecommendation {
  return {
    positionId: 'pos_soxl',
    symbol: 'SOXL',
    kind: 'close-loser',
    label: 'Cut Losses',
    urgency: 'critical',
    confidence: 91,
    primaryReason: 'Loss is near or beyond 1x credit.',
    supportingReasons: ['Days to expiration: 17.'],
    suggestedAction: 'Review closing or rolling defensively.',
    computedAt: NOW.toISOString(),
    managementIntent: {
      intent: 'CUT_LOSSES',
      label: 'Cut Losses',
      reasons: ['Loss has reached the policy loss-stop threshold.'],
      alternatives: [],
      candidates: [],
      winnerScore: 196,
      runnerUpIntent: 'REDUCE_RISK',
      runnerUpScore: 181,
      margin: 15,
      confidenceTier: 'Medium',
    },
    ...overrides,
  };
}

function expandSection() {
  fireEvent.click(screen.getByText('Decision Review'));
}

describe('DecisionReviewSection: collapsed by default', () => {
  it('renders the header collapsed and expands on click', () => {
    render(
      <DecisionReviewSection
        positionId="pos_soxl" symbol="SOXL" strategy="BPS"
        recommendation={makeRecommendation()} review={null} onSave={() => {}} th={THEMES.dark}
      />,
    );
    expect(screen.queryByLabelText('Action Taken')).not.toBeInTheDocument();
    expandSection();
    expect(screen.getByLabelText('Action Taken')).toBeInTheDocument();
  });
});

describe('DecisionReviewSection: creating a review', () => {
  it('calls onSave with a freshly created review reflecting the entered fields', () => {
    const onSave = vi.fn();
    render(
      <DecisionReviewSection
        positionId="pos_soxl" symbol="SOXL" strategy="BPS"
        recommendation={makeRecommendation()} review={null} onSave={onSave} th={THEMES.dark}
      />,
    );
    expandSection();

    fireEvent.change(screen.getByLabelText('Action Taken'), { target: { value: 'CUT_LOSSES' } });
    fireEvent.change(screen.getByLabelText('Outcome Status'), { target: { value: 'FAVORABLE' } });
    fireEvent.change(screen.getByLabelText('Realized P/L (optional)'), { target: { value: '-280' } });
    fireEvent.change(screen.getByLabelText('Notes (optional)'), { target: { value: 'Closed at a smaller loss than modeled.' } });
    fireEvent.click(screen.getByText('Save Review'));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved: DecisionReview = onSave.mock.calls[0][0];
    expect(saved.positionId).toBe('pos_soxl');
    expect(saved.symbol).toBe('SOXL');
    expect(saved.strategy).toBe('BPS');
    expect(saved.traderAction).toBe('CUT_LOSSES');
    expect(saved.outcomeStatus).toBe('FAVORABLE');
    expect(saved.realizedPnl).toBe(-280);
    expect(saved.notes).toBe('Closed at a smaller loss than modeled.');
    expect(saved.evidence.managementIntent).toBe('CUT_LOSSES');
    expect(saved.evidence.label).toBe('Cut Losses');
  });
});

describe('DecisionReviewSection: missing optional P/L and notes', () => {
  it('saves null realizedPnl and an empty notes string when left blank', () => {
    const onSave = vi.fn();
    render(
      <DecisionReviewSection
        positionId="pos_soxl" symbol="SOXL" strategy="BPS"
        recommendation={makeRecommendation()} review={null} onSave={onSave} th={THEMES.dark}
      />,
    );
    expandSection();
    fireEvent.change(screen.getByLabelText('Action Taken'), { target: { value: 'HELD_POSITION' } });
    fireEvent.click(screen.getByText('Save Review'));

    const saved: DecisionReview = onSave.mock.calls[0][0];
    expect(saved.realizedPnl).toBeNull();
    expect(saved.notes).toBe('');
  });
});

describe('DecisionReviewSection: editing an existing review', () => {
  function existingReview(): DecisionReview {
    return createDecisionReview(
      { positionId: 'pos_soxl', symbol: 'SOXL', strategy: 'BPS', recommendation: makeRecommendation(), traderAction: 'CUT_LOSSES', notes: 'initial note' },
      NOW,
    );
  }

  it('pre-fills the form from the existing review', () => {
    render(
      <DecisionReviewSection
        positionId="pos_soxl" symbol="SOXL" strategy="BPS"
        recommendation={makeRecommendation()} review={existingReview()} onSave={() => {}} th={THEMES.dark}
      />,
    );
    expandSection();
    expect(screen.getByLabelText('Action Taken')).toHaveValue('CUT_LOSSES');
    expect(screen.getByLabelText('Notes (optional)')).toHaveValue('initial note');
    expect(screen.getByText('Save Changes')).toBeInTheDocument();
  });

  it('calls onSave with an updated review preserving id/positionId/evidence and applying the edit', () => {
    const onSave = vi.fn();
    const review = existingReview();
    render(
      <DecisionReviewSection
        positionId="pos_soxl" symbol="SOXL" strategy="BPS"
        recommendation={makeRecommendation()} review={review} onSave={onSave} th={THEMES.dark}
      />,
    );
    expandSection();
    fireEvent.change(screen.getByLabelText('Outcome Status'), { target: { value: 'FAVORABLE' } });
    fireEvent.change(screen.getByLabelText('Notes (optional)'), { target: { value: 'Updated note.' } });
    fireEvent.click(screen.getByText('Save Changes'));

    const saved: DecisionReview = onSave.mock.calls[0][0];
    expect(saved.id).toBe(review.id);
    expect(saved.positionId).toBe(review.positionId);
    expect(saved.outcomeStatus).toBe('FAVORABLE');
    expect(saved.notes).toBe('Updated note.');
    expect(saved.evidence).toEqual(review.evidence);
  });
});

describe('DecisionReviewSection: snapshot integrity (ticket #7)', () => {
  it('displays the review\'s frozen evidence, not the live recommendation, when they differ', () => {
    const review = createDecisionReview(
      { positionId: 'pos_soxl', symbol: 'SOXL', strategy: 'BPS', recommendation: makeRecommendation() },
      NOW,
    );
    // Simulate the live recommendation having since changed to Hold Position.
    const liveRecommendation = makeRecommendation({
      label: 'Hold Position',
      managementIntent: {
        intent: 'HOLD_POSITION', label: 'Hold Position', reasons: [], alternatives: [], candidates: [],
        winnerScore: 10, runnerUpIntent: null, runnerUpScore: 0, margin: 10, confidenceTier: 'Low',
      },
    });
    render(
      <DecisionReviewSection
        positionId="pos_soxl" symbol="SOXL" strategy="BPS"
        recommendation={liveRecommendation} review={review} onSave={() => {}} th={THEMES.dark}
      />,
    );
    expandSection();
    const snapshotBlock = screen.getByText('Recommended at the time').closest('div')!;
    expect(within(snapshotBlock).getByText('Cut Losses')).toBeInTheDocument();
    expect(within(snapshotBlock).queryByText('Hold Position')).not.toBeInTheDocument();
  });

  it('editing the review after the live recommendation changed still does not alter the saved evidence', () => {
    const onSave = vi.fn();
    const review = createDecisionReview(
      { positionId: 'pos_soxl', symbol: 'SOXL', strategy: 'BPS', recommendation: makeRecommendation() },
      NOW,
    );
    const liveRecommendation = makeRecommendation({ label: 'Hold Position' });
    render(
      <DecisionReviewSection
        positionId="pos_soxl" symbol="SOXL" strategy="BPS"
        recommendation={liveRecommendation} review={review} onSave={onSave} th={THEMES.dark}
      />,
    );
    expandSection();
    fireEvent.change(screen.getByLabelText('Notes (optional)'), { target: { value: 'checking in' } });
    fireEvent.click(screen.getByText('Save Changes'));
    const saved: DecisionReview = onSave.mock.calls[0][0];
    expect(saved.evidence.label).toBe('Cut Losses');
  });
});
