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
  suggestedAction: 'Refresh broker leg quotes and verify the marketable estimate.',
};

describe('VerifyPricingRefreshButton', () => {
  it('renders only for Verify Pricing recommendations', () => {
    const { rerender } = render(
      <VerifyPricingRefreshButton recommendation={verifyPricingRecommendation} positionKey="MU-spread" portfolioRefreshing={false} onRefresh={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /refresh quotes/i })).toBeInTheDocument();

    rerender(
      <VerifyPricingRefreshButton
        recommendation={{ ...verifyPricingRecommendation, kind: 'watch' }}
        positionKey="MU-spread"
        portfolioRefreshing={false}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /refresh quotes/i })).not.toBeInTheDocument();
  });

  it('performs one refresh, exposes busy state, and permits no retry while in flight', async () => {
    let resolveRefresh!: () => void;
    const onRefresh = vi.fn(() => new Promise<any>(resolve => { resolveRefresh = () => resolve({ status: 'success', positions: [{ key: 'MU-spread', recommendation: verifyPricingRecommendation }] }); }));
    const { rerender } = render(
      <VerifyPricingRefreshButton recommendation={verifyPricingRecommendation} positionKey="MU-spread" portfolioRefreshing={false} onRefresh={onRefresh} />,
    );

    const button = screen.getByRole('button', { name: /refresh quotes/i });
    fireEvent.click(button);
    rerender(
      <VerifyPricingRefreshButton recommendation={verifyPricingRecommendation} positionKey="MU-spread" portfolioRefreshing onRefresh={onRefresh} />,
    );
    fireEvent.click(button);

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveTextContent('REFRESHING QUOTES...');

    resolveRefresh();
    rerender(
      <VerifyPricingRefreshButton recommendation={verifyPricingRecommendation} positionKey="MU-spread" portfolioRefreshing={false} onRefresh={onRefresh} />,
    );
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(await screen.findByRole('status')).toHaveTextContent('pricing is still unverified');
  });

  it('announces refresh failure and a successful recommendation transition', async () => {
    const { rerender } = render(
      <VerifyPricingRefreshButton
        recommendation={verifyPricingRecommendation}
        positionKey="MU-spread"
        portfolioRefreshing={false}
        onRefresh={vi.fn().mockResolvedValue({ status: 'error', message: 'Broker unavailable' })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /refresh quotes/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('pricing remains unverified');

    rerender(
      <VerifyPricingRefreshButton
        recommendation={verifyPricingRecommendation}
        positionKey="MU-spread"
        portfolioRefreshing={false}
        onRefresh={vi.fn().mockResolvedValue({
          status: 'success',
          positions: [{ key: 'MU-spread', recommendation: { ...verifyPricingRecommendation, kind: 'watch' } }],
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /refresh quotes/i }));
    expect(await screen.findByRole('status')).toHaveTextContent('Pricing verified; recommendation updated');
  });
});
