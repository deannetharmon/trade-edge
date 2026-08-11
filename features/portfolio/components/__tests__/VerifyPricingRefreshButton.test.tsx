import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VerifyPricingRefreshButton } from '../VerifyPricingRefreshButton';
import type { PortfolioRecommendation } from '../../recommendations/recommendation-types';

const verifyPricingRecommendation: PortfolioRecommendation = {
  positionId: 'MU-spread',
  symbol: 'MU',
  computedAt: '2026-08-10T18:00:00.000Z',
  kind: 'verify-pricing',
  label: 'Verify Pricing',
  urgency: 'high',
  confidence: 70,
  primaryReason: 'The current quote is not decision-eligible.',
  supportingReasons: [],
  suggestedAction: 'Verify a fresh executable quote.',
};

describe('VerifyPricingRefreshButton', () => {
  it('renders only for Verify Pricing recommendations', () => {
    const { rerender } = render(
      <VerifyPricingRefreshButton recommendation={verifyPricingRecommendation} onRefresh={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /refresh quotes/i })).toBeInTheDocument();

    rerender(
      <VerifyPricingRefreshButton
        recommendation={{ ...verifyPricingRecommendation, kind: 'watch' }}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /refresh quotes/i })).not.toBeInTheDocument();
  });

  it('performs one refresh, exposes busy state, and permits no retry while in flight', async () => {
    let resolveRefresh!: () => void;
    const onRefresh = vi.fn(() => new Promise<void>(resolve => { resolveRefresh = resolve; }));
    render(<VerifyPricingRefreshButton recommendation={verifyPricingRecommendation} onRefresh={onRefresh} />);

    const button = screen.getByRole('button', { name: /refresh quotes/i });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveTextContent('REFRESHING QUOTES...');

    resolveRefresh();
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(button).toHaveAttribute('aria-busy', 'false');
  });
});
