import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PositionRecommendationBadge } from '../PositionRecommendationBadge';
import type { PortfolioRecommendation } from '@/lib/portfolio-intelligence';

const recommendation: PortfolioRecommendation = {
  positionId: 'MU-800-790',
  symbol: 'MU',
  kind: 'watch',
  label: 'Verify Pricing',
  urgency: 'high',
  confidence: 70,
  primaryReason: 'Pricing conflict.',
  supportingReasons: [],
  suggestedAction: 'Verify a fresh executable quote.',
  computedAt: '2026-08-10T18:00:00.000Z',
};

describe('PI-0014C recommendation badge grounding', () => {
  it('shows action and urgency without presenting a fixed rule constant as percentage confidence', () => {
    render(<PositionRecommendationBadge recommendation={recommendation} />);
    expect(screen.getByText('VERIFY PRICING')).toBeInTheDocument();
    expect(screen.getByText('HIGH URGENCY')).toBeInTheDocument();
    expect(screen.queryByText('70%')).not.toBeInTheDocument();
  });
});
