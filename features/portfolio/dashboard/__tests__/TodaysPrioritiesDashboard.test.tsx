import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { THEMES } from '@/lib/theme';
import type { PortfolioObjective } from '@/lib/portfolio-intelligence';
import { PriorityRankedList } from '../TodaysPrioritiesDashboard';

function pricingObjective(): PortfolioObjective {
  return {
    id: 'verify-pricing', createdAt: '2026-08-10T18:00:00.000Z', version: 'portfolio-objective-v1',
    type: 'MANAGE_POSITION', ruleId: 'OBJ-VERIFY-PRICING', title: 'Verify Pricing: MU', summary: 'Pricing conflict.',
    priority: 'high', urgency: 'today', actionability: 'ACTION_NEEDED', confidence: 70, status: 'active', source: 'position',
    subject: { type: 'position', id: 'MU', symbol: 'MU', label: 'MU position' }, rationale: 'Verify pricing.',
    supportingEvidence: [], concerns: [],
    portfolioImpact: { direction: 'neutral', magnitude: 'medium', explanation: 'Verify.' },
    incomeImpact: { direction: 'neutral', magnitude: 'low', explanation: 'Verify.' },
    riskImpact: { direction: 'neutral', magnitude: 'medium', explanation: 'Verify.' },
    capitalImpact: { direction: 'neutral', magnitude: 'low', explanation: 'None.' },
    reviewTriggers: [], metadata: { executionAllowed: false, paperExecutionAllowed: false, rulesEvaluated: [], rulesTriggered: [] },
  };
}

describe('PI-0014C deterministic confidence presentation', () => {
  it('shows rule strength without presenting the fixed internal constant as measured confidence', () => {
    render(<PriorityRankedList items={[{ objective: pricingObjective(), score: 70, tier: 'High', reasons: [] }]} th={THEMES.dark} />);
    expect(screen.getByText('Rule Strength')).toBeInTheDocument();
    expect(screen.getByText('Deterministic')).toBeInTheDocument();
    expect(screen.queryByText('(70%)')).not.toBeInTheDocument();
  });
});
