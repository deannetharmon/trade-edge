// features/portfolio/briefing/__tests__/DailyPortfolioBriefing.trackingActiveChanges.test.tsx
//
// WA-0004 corrective round: the "tracking active, changes present" branch of
// Briefing's "Since Your Last Review" section was previously untested --
// DailyPortfolioBriefing.trackingActive.test.tsx mocked
// TRADER_COMMITMENT_TRACKING_ACTIVE as `true` but never wired a matching
// conductReview() return value, so it exercised the zero-changes path
// regardless of its filename/intent. This file fixes that gap for real:
// TRADER_COMMITMENT_TRACKING_ACTIVE is mocked `true` *and* conductReview()
// itself is mocked to return a ReviewNarrative whose
// sinceLastReview.changes contains a real, changed RevalidationResult (built
// from the actual lib/review-conductor/types.ts and lib/revalidation/types.ts
// shapes) -- proving the per-change markup (subject label, whatChanged,
// whyItMatters, whyNow) genuinely renders, not incidentally.
//
// Kept in its own file, separate from the genuine-zero-change test, because
// vi.mock is hoisted and applies for the whole module across every test in
// a file -- a single file cannot give conductReview() two different mock
// return values without vi.resetModules()/per-test dynamic import, which
// would be more fragile than just splitting the file.
//
// This is required, covered test behavior -- not a disclosed or deferred
// gap. No Trader Commitment persistence is implemented anywhere; the
// commitment/RevalidationResult fixtures below are test-only, exactly as
// the CES requires (section 19's explicit non-goal).

import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { THEMES } from '@/lib/theme';
import type { DailyBriefing } from '@/lib/dailyBriefing';
import type { PortfolioReviewSnapshot } from '@/lib/portfolioReview';
import type { TodaysPrioritiesDashboard } from '@/lib/todaysPriorities';
import type { ReviewNarrative } from '@/lib/review-conductor';
import type { RevalidationResult } from '@/lib/revalidation';
import { createTraderCommitment } from '@/lib/trader-commitments';

const FIXED_NOW = '2026-07-25T00:00:00.000Z';

function makeChangedResult(): RevalidationResult {
  const commitment = createTraderCommitment(
    { kind: 'HOLD_UNTIL_DTE', subject: { type: 'position', id: 'pos_msft', symbol: 'MSFT', label: 'MSFT BPS' }, targetDte: 21 },
    new Date(FIXED_NOW),
  );
  return {
    commitment,
    changed: true,
    change: {
      whatChanged: 'MSFT BPS reached 21 DTE, its committed management window.',
      whyItMatters: 'This position was held specifically until this DTE threshold; the condition that ends the commitment has now occurred.',
      whyNow: 'Waiting past today risks losing the remaining extrinsic value the commitment was written to capture.',
    },
  };
}

function narrativeWithChanges(): ReviewNarrative {
  const changes = [makeChangedResult()];
  return {
    generatedAt: FIXED_NOW,
    portfolioStatus: {
      review: {
        generatedAt: FIXED_NOW,
        currentState: {
          health: { score: 82, status: 'Healthy', positiveContributors: [], negativeContributors: [] },
          topRisks: [],
          concentrationConcerns: [],
          capitalConcerns: [],
          incomeConcern: null,
        },
        composition: { positionCount: 3, byStrategy: { BPS: 3 }, symbolConcentrationPct: {}, maxSymbolConcentrationPct: null, wheelManagedFraction: null },
      } as any,
    },
    sinceLastReview: { changes },
    attention: { items: [] },
    newOpportunities: { items: [] },
    leadItem: { kind: 'COMMITMENT_CHANGE', result: changes[0] },
    shouldInterrupt: true,
    counts: { changes: changes.length, attention: 0, opportunities: 0 },
    complete: { isComplete: false, message: 'Review not complete.' },
  };
}

// vi.mock calls are hoisted above every import in this file (including the
// DailyPortfolioBriefing import below), so the component picks up both the
// mocked flag and the mocked conductReview() return value regardless of
// import order. Only @/lib/review-conductor is mocked -- everything else
// (lib/trader-commitments, lib/dailyBriefing, etc.) is real.
vi.mock('@/lib/review-conductor', async () => {
  const actual = await vi.importActual<typeof import('@/lib/review-conductor')>('@/lib/review-conductor');
  return {
    ...actual,
    TRADER_COMMITMENT_TRACKING_ACTIVE: true,
    conductReview: vi.fn(() => narrativeWithChanges()),
  };
});

import { DailyPortfolioBriefing } from '../DailyPortfolioBriefing';

function makeDailyBriefing(overrides: Partial<DailyBriefing> = {}): DailyBriefing {
  return {
    generatedAt: FIXED_NOW,
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
    generatedAt: FIXED_NOW,
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

describe('WA-0004: DailyPortfolioBriefing -- tracking active, changes present (genuinely exercised)', () => {
  it('renders the full Since Your Last Review presentation -- subject label, whatChanged, whyItMatters, and whyNow -- and never the zero-changes copy', () => {
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
    expect(within(section).getByText('MSFT BPS')).toBeInTheDocument();
    expect(within(section).getByText('MSFT BPS reached 21 DTE, its committed management window.')).toBeInTheDocument();
    expect(
      within(section).getByText('This position was held specifically until this DTE threshold; the condition that ends the commitment has now occurred.'),
    ).toBeInTheDocument();
    expect(
      within(section).getByText('Waiting past today risks losing the remaining extrinsic value the commitment was written to capture.'),
    ).toBeInTheDocument();
    expect(within(section).queryByText('Nothing changed since your last review.')).not.toBeInTheDocument();
    expect(within(section).queryByText('Change tracking is not yet active.')).not.toBeInTheDocument();
  });
});
