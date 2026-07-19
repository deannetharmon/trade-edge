// components/command-center/__tests__/CommandCenter.test.tsx
//
// TC-0001: component-level coverage for the Trade Command Center composition
// itself. Verifies: the six panels render in the exact desktop reading order
// required by docs/design/TC-0001-Trade-Command-Center.md section 6.1;
// navigation into every existing workflow is present; the required
// empty-state copy renders correctly end-to-end through real card
// components (not just the view-model layer); and the whole surface is
// strictly read-only -- no control anywhere submits, executes, or otherwise
// mutates a broker-side order.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { THEMES } from '@/lib/theme';
import { CommandCenter } from '../CommandCenter';
import { buildCommandCenterViewModel } from '@/lib/command-center';
import type { DashboardComposition } from '@/lib/portfolio-intelligence/dashboardComposition';

const FIXED_NOW = new Date('2026-07-19T09:00:00.000Z');

function emptyViewModel() {
  return buildCommandCenterViewModel({
    composition: null,
    opportunityRecommendations: [],
    tasks: [],
    now: FIXED_NOW,
  });
}

function loadedComposition(): DashboardComposition {
  return {
    canonicalPriorities: null,
    todaysPrioritiesDashboard: { immediateAction: [], monitor: [], onTrack: [] } as any,
    topPriority: null,
    averagePositionHealth: null,
    portfolioHealth: { score: 91, status: 'Healthy' } as any,
    portfolioReview: null,
    dailyBriefing: {
      executiveSummary: 'Portfolio is stable; no action required today.',
      priorities: [],
    } as any,
  };
}

describe('TC-0001: CommandCenter layout', () => {
  it('renders all six required panels in the exact required desktop reading order', () => {
    render(<CommandCenter viewModel={emptyViewModel()} th={THEMES.dark} />);

    const container = screen.getByLabelText('Command Center navigation').parentElement!;
    const sectionLabels = Array.from(container.querySelectorAll('[aria-label]')).map(el =>
      el.getAttribute('aria-label'),
    );

    expect(sectionLabels).toEqual([
      'Command Center navigation',
      'Command Center Header',
      'Daily Briefing Summary',
      "Today's Priorities",
      'Best Opportunity',
      'Portfolio Health',
      'Background Tasks',
    ]);
  });

  it('renders navigation links to every existing workflow the design spec requires', () => {
    render(<CommandCenter viewModel={emptyViewModel()} th={THEMES.dark} />);

    expect(screen.getByRole('link', { name: 'Portfolio' })).toHaveAttribute('href', '/portfolio');
    expect(screen.getByRole('link', { name: 'Screener / Hunter' })).toHaveAttribute('href', '/screener');
    expect(screen.getByRole('link', { name: 'Opportunity Review' })).toHaveAttribute('href', '#best-opportunity');
    expect(screen.getByRole('link', { name: 'Paper Trading' })).toHaveAttribute('href', '/paper-trading');
    expect(screen.getByRole('link', { name: 'Performance' })).toHaveAttribute('href', '/performance');
    expect(screen.getByRole('link', { name: 'Trade Log' })).toHaveAttribute('href', '/trade-log');
  });

  it('renders the exact required empty-state copy for panels with no data source this sprint (composition unavailable)', () => {
    render(<CommandCenter viewModel={emptyViewModel()} th={THEMES.dark} />);

    expect(screen.getByText('No ranked opportunity feed is available.')).toBeInTheDocument();
    expect(screen.getByText('No background tasks are running.')).toBeInTheDocument();
  });

  it('renders the exact required empty-state copy for Priorities/Briefing when composition exists but is genuinely empty', () => {
    const viewModel = buildCommandCenterViewModel({
      composition: { ...loadedComposition(), dailyBriefing: { executiveSummary: 'All clear.', priorities: [] } as any },
      opportunityRecommendations: [],
      tasks: [],
      now: FIXED_NOW,
    });
    render(<CommandCenter viewModel={viewModel} th={THEMES.dark} />);

    expect(screen.getByText('No portfolio actions currently require attention.')).toBeInTheDocument();
  });

  it('renders the exact required empty-state copy for Briefing when dailyBriefing itself is null', () => {
    const viewModel = buildCommandCenterViewModel({
      composition: { ...loadedComposition(), dailyBriefing: null },
      opportunityRecommendations: [],
      tasks: [],
      now: FIXED_NOW,
    });
    render(<CommandCenter viewModel={viewModel} th={THEMES.dark} />);

    expect(screen.getByText('Daily Briefing is unavailable.')).toBeInTheDocument();
  });

  it('renders real Daily Briefing and Portfolio Health content verbatim when a composition is provided', () => {
    const viewModel = buildCommandCenterViewModel({
      composition: loadedComposition(),
      opportunityRecommendations: [],
      tasks: [],
      now: FIXED_NOW,
    });
    render(<CommandCenter viewModel={viewModel} th={THEMES.dark} />);

    expect(screen.getByText('Portfolio is stable; no action required today.')).toBeInTheDocument();
    expect(screen.getByText('91')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });

  it('is strictly read-only -- renders no control that submits, executes, replaces, or cancels a broker order', () => {
    const viewModel = buildCommandCenterViewModel({
      composition: loadedComposition(),
      opportunityRecommendations: [],
      tasks: [],
      now: FIXED_NOW,
    });
    render(<CommandCenter viewModel={viewModel} th={THEMES.dark} />);

    const buttons = screen.queryAllByRole('button');
    expect(buttons).toHaveLength(0);

    const forbidden = /submit|execute|place order|cancel order|replace order|buy|sell/i;
    for (const el of screen.queryAllByRole('link')) {
      expect(el.textContent ?? '').not.toMatch(forbidden);
    }
  });
});
