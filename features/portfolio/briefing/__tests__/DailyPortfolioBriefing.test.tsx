// features/portfolio/briefing/__tests__/DailyPortfolioBriefing.test.tsx
//
// PI-0004D: component-level coverage for the Daily Portfolio Briefing.

import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { THEMES } from '@/lib/theme';
import { DailyPortfolioBriefing } from '../DailyPortfolioBriefing';
import type { PortfolioObjective } from '@/lib/portfolio-intelligence';

function makeObjective(overrides: Partial<PortfolioObjective> = {}): PortfolioObjective {
  return {
    id: `obj_${Math.random().toString(36).slice(2, 9)}`,
    createdAt: '2026-07-12T00:00:00.000Z',
    version: 'portfolio-objective-v1',
    type: 'REVIEW_THREATENED_POSITION',
    ruleId: 'OBJ-EARNINGS-RISK',
    title: 'Earnings Risk: AMD',
    summary: 'Review AMD before earnings later this week.',
    priority: 'high',
    urgency: 'today',
    actionability: 'ACTION_NEEDED',
    confidence: 86,
    status: 'active',
    source: 'position',
    subject: { type: 'position', id: 'pos_amd', symbol: 'AMD', label: 'AMD' },
    rationale: 'rationale',
    supportingEvidence: [],
    concerns: [],
    portfolioImpact: { direction: 'negative', magnitude: 'medium', explanation: 'n/a' },
    incomeImpact: { direction: 'neutral', magnitude: 'low', explanation: 'n/a' },
    riskImpact: { direction: 'negative', magnitude: 'medium', explanation: 'n/a' },
    capitalImpact: { direction: 'neutral', magnitude: 'low', explanation: 'n/a' },
    reviewTriggers: [],
    metadata: { executionAllowed: false, paperExecutionAllowed: false, rulesEvaluated: [], rulesTriggered: [] },
    ...overrides,
  };
}

function makeWait(): PortfolioObjective {
  return makeObjective({
    type: 'WAIT', ruleId: 'OBJ-WAIT', title: 'No action required', priority: 'informational',
    urgency: 'none', actionability: 'MONITOR', subject: { type: 'portfolio', label: 'Portfolio' },
  });
}

beforeEach(() => {
  localStorage.clear();
});

describe('PI-0004D: DailyPortfolioBriefing -- section order and content', () => {
  it('renders Portfolio Health, Today\'s Priorities (Open Priorities), Portfolio Summary, and Suggested Focus, in that order', () => {
    render(<DailyPortfolioBriefing objectives={[makeObjective()]} loading={false} th={THEMES.dark} />);

    const container = screen.getByLabelText('Daily Portfolio Briefing');
    const sectionLabels = Array.from(container.querySelectorAll('[aria-label]')).map((el) => el.getAttribute('aria-label'));
    // TodaysPrioritiesWorkflow renders its Open Priorities section (reused
    // verbatim -- see the "does not duplicate" test below) rather than a
    // separately-labeled "Today's Priorities" section.
    expect(sectionLabels).toEqual(['Portfolio Health', 'Open Priorities', 'Portfolio Summary', 'Suggested Focus']);
  });

  it('shows the Action Required health status for a critical top objective', () => {
    render(<DailyPortfolioBriefing objectives={[makeObjective({ priority: 'critical', actionability: 'CRITICAL' })]} loading={false} th={THEMES.dark} />);
    expect(screen.getByText('Action Required')).toBeInTheDocument();
  });

  it('shows the Healthy status and "No action required today." for a WAIT-only portfolio', () => {
    render(<DailyPortfolioBriefing objectives={[makeWait()]} loading={false} th={THEMES.dark} />);
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    expect(screen.getByText('No action required today.')).toBeInTheDocument();
    expect(screen.getByText('Portfolio remains healthy.')).toBeInTheDocument();
  });

  it('reuses TodaysPrioritiesWorkflow verbatim (Open Priorities section present)', () => {
    render(<DailyPortfolioBriefing objectives={[makeObjective()]} loading={false} th={THEMES.dark} />);
    expect(screen.getByText('Open Priorities')).toBeInTheDocument();
    expect(screen.getByText('Earnings Risk: AMD')).toBeInTheDocument();
  });

  it('renders the Suggested Focus line from the top objective', () => {
    render(<DailyPortfolioBriefing objectives={[makeObjective()]} loading={false} th={THEMES.dark} />);
    const focusSection = within(screen.getByLabelText('Suggested Focus'));
    expect(focusSection.getByText('AMD: Review AMD before earnings later this week.')).toBeInTheDocument();
  });
});

describe('PI-0004D: DailyPortfolioBriefing -- What Changed', () => {
  it('omits the What Changed section on the very first render (no stored baseline)', () => {
    render(<DailyPortfolioBriefing objectives={[makeObjective()]} loading={false} th={THEMES.dark} />);
    expect(screen.queryByLabelText('What Changed')).not.toBeInTheDocument();
  });

  it('shows What Changed on a later render once a material change is detected against the stored snapshot', async () => {
    const original = makeObjective({ priority: 'high' });
    const { rerender } = render(<DailyPortfolioBriefing objectives={[original]} loading={false} th={THEMES.dark} />);
    // First render establishes the baseline snapshot (no diff shown).
    expect(screen.queryByLabelText('What Changed')).not.toBeInTheDocument();

    const escalated = makeObjective({ priority: 'critical', actionability: 'CRITICAL' });
    rerender(<DailyPortfolioBriefing objectives={[escalated]} loading={false} th={THEMES.dark} />);

    const changedSection = await screen.findByLabelText('What Changed');
    expect(within(changedSection).getByText(/Earnings Risk: AMD/)).toBeInTheDocument();
    expect(within(changedSection).getByText('Changed')).toBeInTheDocument();
  });
});

describe('PI-0004D: DailyPortfolioBriefing -- loading/null passthrough', () => {
  it('shows a loading placeholder when objectives is null and loading is true', () => {
    render(<DailyPortfolioBriefing objectives={null} loading={true} th={THEMES.dark} />);
    expect(screen.getByText(/Loading briefing/)).toBeInTheDocument();
  });

  it('renders nothing when objectives is null and not loading', () => {
    const { container } = render(<DailyPortfolioBriefing objectives={null} loading={false} th={THEMES.dark} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('PI-0004D: does not duplicate Portfolio Intelligence or Today\'s Priorities logic', () => {
  it('does not import any Portfolio Intelligence evaluation function or re-implement the priorities workflow', async () => {
    const fs = await import('node:fs/promises');
    const text = await fs.readFile('features/portfolio/briefing/DailyPortfolioBriefing.tsx', 'utf-8');
    expect(text).not.toContain('evaluatePortfolioObjectives');
    expect(text).not.toContain('evaluatePositionObjective');
    expect(text).not.toContain('prioritizePortfolioObjectives');
    expect(text).not.toContain('markComplete');
    expect(text).not.toContain('partitionPriorities');
  });
});
