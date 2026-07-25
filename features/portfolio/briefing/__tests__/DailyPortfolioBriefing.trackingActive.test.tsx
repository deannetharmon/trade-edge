// features/portfolio/briefing/__tests__/DailyPortfolioBriefing.trackingActive.test.tsx
//
// WA-0004: covers Briefing's "Since Your Last Review" tracking-active,
// genuine-zero-change state via a module mock of
// TRADER_COMMITMENT_TRACKING_ACTIVE (today's real value is `false`; a
// future persistence-wiring sprint is the only way this becomes `true` in
// production, so this state is only reachable in tests today). The
// tracking-active, changes-present state is covered separately in
// DailyPortfolioBriefing.trackingActiveChanges.test.tsx -- kept in its own
// file because vi.mock is hoisted and applies for the whole module across
// every test in a file, and that state additionally needs conductReview()
// itself mocked to return a populated sinceLastReview.changes array (the
// component builds its own conductReview() input internally, per CES
// section 12, with a hardcoded revalidationResults: [] placeholder -- so
// exercising a populated `changes` array requires overriding
// conductReview()'s return value, not just the tracking flag).

import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { THEMES } from '@/lib/theme';
import type { DailyBriefing } from '@/lib/dailyBriefing';
import type { PortfolioReviewSnapshot } from '@/lib/portfolioReview';
import type { TodaysPrioritiesDashboard } from '@/lib/todaysPriorities';

// vi.mock calls are hoisted above every import in this file (including the
// DailyPortfolioBriefing import below), so the component picks up the
// mocked flag regardless of import order.
vi.mock('@/lib/review-conductor', async () => {
  const actual = await vi.importActual<typeof import('@/lib/review-conductor')>('@/lib/review-conductor');
  return { ...actual, TRADER_COMMITMENT_TRACKING_ACTIVE: true };
});

import { DailyPortfolioBriefing } from '../DailyPortfolioBriefing';

function makeDailyBriefing(overrides: Partial<DailyBriefing> = {}): DailyBriefing {
  return {
    generatedAt: '2026-07-25T00:00:00.000Z',
    executiveSummary: 'Portfolio is Healthy.',
    priorities: [],
    snapshot: { healthScore: 82, healthStatus: 'Healthy', openPositionCount: 3, capitalDeploymentPct: 45, largestConcentrationPct: 22.5, averagePositionHealth: 74 },
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

const EMPTY_DASHBOARD: TodaysPrioritiesDashboard = {
  immediateAction: [],
  reviewToday: { mediumPriority: [], earningsReviews: [], expiringPositions: [], needsFollowUp: [] },
  monitor: [],
  opportunities: { rollOpportunities: [], coveredCallOpportunities: [], cspOpportunities: [], screenerCandidatesAvailable: false },
} as any;

function makePortfolioReview(): PortfolioReviewSnapshot {
  return {
    generatedAt: '2026-07-25T00:00:00.000Z',
    currentState: {
      health: { score: 82, status: 'Healthy', positiveContributors: [], negativeContributors: [] },
      topRisks: [],
      concentrationConcerns: [],
      capitalConcerns: [],
      incomeConcern: null,
    },
    composition: { positionCount: 3, byStrategy: { BPS: 3 }, symbolConcentrationPct: {}, maxSymbolConcentrationPct: null, wheelManagedFraction: null },
  } as any;
}

describe('WA-0004: DailyPortfolioBriefing -- tracking active, genuine zero changes', () => {
  it('renders "Nothing changed since your last review." only in this state', () => {
    render(
      <DailyPortfolioBriefing
        objectives={null}
        dailyBriefing={makeDailyBriefing()}
        portfolioReview={makePortfolioReview()}
        todaysPrioritiesDashboard={EMPTY_DASHBOARD}
        loading={false}
        th={THEMES.dark}
      />,
    );
    const section = screen.getByLabelText('Since Your Last Review');
    expect(within(section).getByText('Nothing changed since your last review.')).toBeInTheDocument();
    expect(within(section).queryByText('Change tracking is not yet active.')).not.toBeInTheDocument();
  });
});
