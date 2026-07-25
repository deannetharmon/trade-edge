// features/portfolio/dailyBriefing/__tests__/DailyBriefingCard.test.tsx
//
// PI-0013: component-level coverage for the Daily Briefing card -- rendering
// of a fully-populated briefing, clean empty states, and a basic check that
// the responsive grid classes required for single-column mobile layout are
// present (jsdom does not evaluate CSS breakpoints, so this checks markup
// rather than rendered layout).

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { THEMES } from '@/lib/theme';
import { DailyBriefingCard } from '../DailyBriefingCard';
import type { DailyBriefing } from '@/lib/dailyBriefing';

function makeBriefing(overrides: Partial<DailyBriefing> = {}): DailyBriefing {
  return {
    generatedAt: '2026-07-17T00:00:00.000Z',
    executiveSummary: 'Portfolio is Healthy. No positions require immediate attention today. No earnings events occur before the next management window.',
    priorities: [],
    snapshot: {
      healthScore: 82,
      healthStatus: 'Healthy',
      openPositionCount: 0,
      capitalDeploymentPct: null,
      largestConcentrationPct: null,
      averagePositionHealth: null,
    },
    upcomingEvents: [],
    opportunities: [
      { kind: 'roll', label: 'Roll Opportunities', count: 0 },
      { kind: 'covered_call', label: 'Covered Call Opportunities', count: 0 },
      { kind: 'csp', label: 'CSP Opportunities', count: 0 },
      { kind: 'screener', label: 'Screener Candidates Available', count: 0 },
    ],
    risks: [],
    ...overrides,
  };
}

describe('PI-0013: DailyBriefingCard', () => {
  it('renders nothing when briefing is null and not loading', () => {
    const { container } = render(<DailyBriefingCard briefing={null} loading={false} th={THEMES.dark} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a loading state when briefing is null and loading', () => {
    render(<DailyBriefingCard briefing={null} loading={true} th={THEMES.dark} />);
    expect(screen.getByText(/Loading Today.s Briefing/)).toBeInTheDocument();
  });

  it('renders all six sections in order', () => {
    render(<DailyBriefingCard briefing={makeBriefing()} loading={false} th={THEMES.dark} />);

    const container = screen.getByLabelText("Today's Briefing");
    const sectionLabels = Array.from(container.querySelectorAll('[aria-label]')).map((el) => el.getAttribute('aria-label'));
    expect(sectionLabels).toEqual([
      'Executive Summary',
      "Today's Priorities",
      'Portfolio Snapshot',
      'Upcoming Events',
      'Current Opportunities',
      'Current Risks',
    ]);
  });

  it('renders the executive summary text verbatim', () => {
    const briefing = makeBriefing({ executiveSummary: 'Portfolio is Action Required. 2 positions require attention today.' });
    render(<DailyBriefingCard briefing={briefing} loading={false} th={THEMES.dark} />);
    expect(screen.getByText(briefing.executiveSummary)).toBeInTheDocument();
  });

  it('renders snapshot stats from the briefing', () => {
    const briefing = makeBriefing({
      snapshot: { healthScore: 61, healthStatus: 'Needs Attention', openPositionCount: 8, capitalDeploymentPct: 45, largestConcentrationPct: 22.5, averagePositionHealth: 74 },
    });
    render(<DailyBriefingCard briefing={briefing} loading={false} th={THEMES.dark} />);

    expect(screen.getByText('61')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('45%')).toBeInTheDocument();
    expect(screen.getByText('22.5%')).toBeInTheDocument();
    expect(screen.getByText('74')).toBeInTheDocument();
  });

  it('renders upcoming events and risks when present', () => {
    const briefing = makeBriefing({
      upcomingEvents: [{ id: 'e1', kind: 'earnings', label: 'Earnings Risk: AMD', symbol: 'AMD', detail: 'Earnings before expiration.' }],
      risks: [{ id: 'r1', kind: 'concentration', label: 'Reduce Concentration: AAPL', detail: 'Above limit.' }],
    });
    render(<DailyBriefingCard briefing={briefing} loading={false} th={THEMES.dark} />);

    expect(screen.getByText('Earnings Risk: AMD')).toBeInTheDocument();
    expect(screen.getByText('Reduce Concentration: AAPL')).toBeInTheDocument();
  });

  it('renders clean empty states for priorities, upcoming events, and risks', () => {
    render(<DailyBriefingCard briefing={makeBriefing()} loading={false} th={THEMES.dark} />);

    expect(screen.getByText('Nothing urgent enough to lead with right now.')).toBeInTheDocument();
    expect(screen.getByText('No upcoming events right now.')).toBeInTheDocument();
    expect(screen.getByText('No active risks right now.')).toBeInTheDocument();
  });

  it('uses single-column-first responsive grid classes for mobile layout', () => {
    const { container } = render(<DailyBriefingCard briefing={makeBriefing()} loading={false} th={THEMES.dark} />);
    const snapshotGrid = screen.getByLabelText('Portfolio Snapshot').querySelector('div.grid');
    const opportunityGrid = screen.getByLabelText('Current Opportunities').querySelector('div.grid');

    // Base (mobile) class has no breakpoint prefix -- grid-cols-2 as the
    // smallest layout, expanding at sm/lg -- never a bare grid-cols-N that
    // would force horizontal scrolling on a narrow screen.
    expect(snapshotGrid?.className).toMatch(/grid-cols-2/);
    expect(opportunityGrid?.className).toMatch(/grid-cols-2/);
    expect(container.querySelector('.overflow-x-auto')).toBeNull();
  });

  // WA-0002: default/'full' variant behavior above is unchanged (no test
  // above passes `variant` at all, so it exercises the default). The cases
  // below cover the new 'transitional' variant used on Positions.
  describe("WA-0002: 'transitional' variant", () => {
    it('renders only Executive Summary, Portfolio Snapshot, and Upcoming Events', () => {
      render(<DailyBriefingCard briefing={makeBriefing()} loading={false} th={THEMES.dark} variant="transitional" />);

      const container = screen.getByLabelText("Today's Briefing");
      const sectionLabels = Array.from(container.querySelectorAll('[aria-label]'))
        .map((el) => el.getAttribute('aria-label'))
        .filter((label) => label !== 'Transitional Content Notice');
      expect(sectionLabels).toEqual(['Executive Summary', 'Portfolio Snapshot', 'Upcoming Events']);
    });

    it('displays the temporary-content label', () => {
      render(<DailyBriefingCard briefing={makeBriefing()} loading={false} th={THEMES.dark} variant="transitional" />);
      expect(screen.getByText(/Temporary/i)).toBeInTheDocument();
      expect(screen.getByText(/moving to Briefing in WA-0004/i)).toBeInTheDocument();
    });

    it("excludes Today's Priorities, Current Opportunities, and Current Risks", () => {
      const briefing = makeBriefing({
        priorities: [],
        risks: [{ id: 'r1', kind: 'concentration', label: 'Reduce Concentration: AAPL', detail: 'Above limit.' }],
      });
      render(<DailyBriefingCard briefing={briefing} loading={false} th={THEMES.dark} variant="transitional" />);

      expect(screen.queryByLabelText("Today's Priorities")).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Current Opportunities')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Current Risks')).not.toBeInTheDocument();
      expect(screen.queryByText('Reduce Concentration: AAPL')).not.toBeInTheDocument();
    });

    it('still renders Executive Summary/Snapshot/Upcoming Events content correctly', () => {
      const briefing = makeBriefing({
        executiveSummary: 'Portfolio is Healthy today.',
        snapshot: { healthScore: 90, healthStatus: 'Healthy', openPositionCount: 4, capitalDeploymentPct: 30, largestConcentrationPct: 10, averagePositionHealth: 88 },
        upcomingEvents: [{ id: 'e1', kind: 'earnings', label: 'Earnings Risk: AMD', symbol: 'AMD', detail: 'Earnings before expiration.' }],
      });
      render(<DailyBriefingCard briefing={briefing} loading={false} th={THEMES.dark} variant="transitional" />);

      expect(screen.getByText('Portfolio is Healthy today.')).toBeInTheDocument();
      expect(screen.getByText('90')).toBeInTheDocument();
      expect(screen.getByText('Earnings Risk: AMD')).toBeInTheDocument();
    });

    it('defaulting variant to "full" when omitted still renders all six sections (regression guard)', () => {
      render(<DailyBriefingCard briefing={makeBriefing()} loading={false} th={THEMES.dark} />);
      const container = screen.getByLabelText("Today's Briefing");
      const sectionLabels = Array.from(container.querySelectorAll('[aria-label]')).map((el) => el.getAttribute('aria-label'));
      expect(sectionLabels).toEqual([
        'Executive Summary',
        "Today's Priorities",
        'Portfolio Snapshot',
        'Upcoming Events',
        'Current Opportunities',
        'Current Risks',
      ]);
    });
  });
});
