import { describe, expect, it } from 'vitest';
import type { PortfolioRecommendation } from '@/lib/portfolio-intelligence';
import {
  canonicalRecommendationForCard,
  canonicalRecommendationPriority,
  canonicalRecommendationToAction,
  projectCanonicalRecommendationForAi,
} from '../canonicalRecommendationPresentation';

function recommendation(kind: PortfolioRecommendation['kind'], label: string): PortfolioRecommendation {
  return {
    positionId: 'MU-spread', symbol: 'MU', kind, label, urgency: 'high', confidence: 70,
    primaryReason: 'Canonical reason', supportingReasons: [], suggestedAction: 'Canonical next action',
    computedAt: '2026-08-10T18:00:00.000Z',
  };
}

describe('PM-0002 canonical recommendation presentation', () => {
  it('keeps Verify Pricing as the public label even though its compatible manual action bucket is MANAGE', () => {
    const result = canonicalRecommendationForCard(
      recommendation('verify-pricing', 'Verify Pricing'),
    );
    expect(result).toEqual({ action: 'MANAGE', detail: 'Canonical next action', publicLabel: 'Verify Pricing' });
    expect(result.publicLabel).not.toBe('Manage');
  });

  it('maps every canonical kind without consulting AI output', () => {
    expect(canonicalRecommendationToAction('close-loser')).toBe('CUT_LOSSES');
    expect(canonicalRecommendationToAction('close-winner')).toBe('TAKE_PROFIT');
    expect(canonicalRecommendationToAction('assignment-risk')).toBe('MANAGE');
    expect(canonicalRecommendationToAction('hold')).toBe('HOLD');
  });

  it('sorts by canonical recommendation priority', () => {
    expect(canonicalRecommendationPriority(recommendation('close-loser', 'Cut Losses')))
      .toBeLessThan(canonicalRecommendationPriority(recommendation('verify-pricing', 'Verify Pricing')));
    expect(canonicalRecommendationPriority(recommendation('verify-pricing', 'Verify Pricing')))
      .toBeLessThan(canonicalRecommendationPriority(recommendation('hold', 'Hold')));
  });

  it('projects every visible AI field from canonical evidence', () => {
    const projected = projectCanonicalRecommendationForAi(recommendation('hold', 'Hold'));
    expect(projected).toMatchObject({
      recommendation: 'HOLD',
      confidence: 'LOW',
      summary: 'Canonical next action',
      reasoning: 'Canonical reason',
      risks: [], catalysts: [], deviatesFromRules: false, deviationNote: null,
    });
    expect(JSON.stringify(projected)).not.toContain('Cut losses now');
  });

  it('fails closed instead of invoking a legacy recommendation when canonical state is absent', () => {
    expect(canonicalRecommendationForCard(null)).toEqual({
      action: 'WATCH',
      detail: 'Canonical recommendation is unavailable. Refresh portfolio data before acting.',
      publicLabel: 'Recommendation Unavailable',
    });
  });
});
