// components/mission-control/__tests__/MissionControl.test.tsx
//
// MB-0002/WA-0004: component-level coverage for the Mission Control layout.
// Verifies: narrative sections render in the exact required order on every
// render (order is DOM order, not CSS -- see MissionControl.tsx's module
// doc); the first-viewport Summary Strip answers all three mission
// questions without needing any of the sections below; each non-loaded
// state (loading/error/unavailable) renders its own honest, distinct
// message; empty-state copy for each narrative section renders through real
// components; the completion band renders both the complete and
// not-complete cases; the whole surface remains strictly read-only; and
// (WA-0004) the reduced "Since Your Last Review" summary honestly
// distinguishes tracking-unavailable from a genuine zero-change result, and
// its deep link is always the absolute /portfolio?tab=briefing path.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { THEMES } from '@/lib/theme';
import { MissionControl } from '../MissionControl';
import type {
  MissionControlSinceLastReviewSummary,
  MissionControlTodaysPrioritiesSummary,
  MissionControlViewModel,
} from '@/lib/mission-control';
import type { ReviewNarrative } from '@/lib/review-conductor';
import type { AttentionItem } from '@/lib/morning-briefing';
import type { RevalidationResult } from '@/lib/revalidation';
import type { TodaysPrioritiesQueueItem } from '@/lib/todays-priorities-queue';
import { createTraderCommitment } from '@/lib/trader-commitments';

const EMPTY_TODAYS_PRIORITIES: MissionControlTodaysPrioritiesSummary = { leadItem: null, openCount: 0, deepLink: null };

// WA-0004: today's real, only-possible state (TRADER_COMMITMENT_TRACKING_ACTIVE
// is false) -- matches buildMissionControlViewModel.ts's own
// buildSinceLastReviewSummary(null)/tracking-inactive output exactly.
const TRACKING_INACTIVE_SINCE_LAST_REVIEW: MissionControlSinceLastReviewSummary = {
  trackingActive: false,
  leadText: 'Change tracking is not yet active.',
  count: null,
  summary: 'Commitment tracking is not yet active.',
  deepLink: '/portfolio?tab=briefing',
};

function makeQueueItem(overrides: Partial<TodaysPrioritiesQueueItem> = {}): TodaysPrioritiesQueueItem {
  return {
    kind: 'attention',
    id: 'obj_1',
    stableKey: 'attention::OBJ-X::position::pos_1',
    subjectId: 'pos_1',
    headline: 'Hold Position: AAPL reached 21 DTE target',
    detail: 'Close or roll before expiration.',
    completable: true,
    ...overrides,
  };
}

const FIXED_NOW = '2026-07-25T09:00:00.000Z';

function makeReview(overrides: Partial<ReviewNarrative['portfolioStatus']['review']> = {}) {
  return {
    generatedAt: FIXED_NOW,
    currentState: {
      health: { score: 82, status: 'Healthy' as const, positiveContributors: [], negativeContributors: [] },
      topRisks: [],
      concentrationConcerns: [],
      capitalConcerns: [],
      incomeConcern: null,
    },
    composition: {
      positionCount: 3,
      byStrategy: { BPS: 3 },
      symbolConcentrationPct: {},
      maxSymbolConcentrationPct: null,
      wheelManagedFraction: null,
    },
    ...overrides,
  };
}

function makeAttentionItem(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id: 'obj_1',
    subjectId: 'pos_1',
    symbol: 'AAPL',
    strategy: null,
    band: 'WATCH',
    source: 'MEDIUM_PRIORITY',
    score: 50,
    tier: 'Medium',
    headline: 'Hold Position: AAPL reached 21 DTE target',
    recommendedAction: 'Close or roll before expiration.',
    reasons: [],
    explanation: { confidenceLabel: 'High', confidenceScore: 80, decisionDrivers: [], whyNow: ['Risk threshold crossed.'] },
    objective: null,
    ...overrides,
  };
}

function makeRevalidationResult(): RevalidationResult {
  const commitment = createTraderCommitment(
    { kind: 'HOLD_UNTIL_DTE', subject: { type: 'position', id: 'pos_2', symbol: 'MSFT', label: 'MSFT BPS' }, targetDte: 21 },
    new Date(FIXED_NOW),
  );
  return { commitment, changed: true, change: { whatChanged: 'MSFT BPS reached 21 DTE.', whyItMatters: 'Matters.', whyNow: 'Now.' } };
}

function narrativeFor(overrides: Partial<ReviewNarrative> = {}): ReviewNarrative {
  return {
    generatedAt: FIXED_NOW,
    portfolioStatus: { review: makeReview() as any },
    sinceLastReview: { changes: [] },
    attention: { items: [] },
    newOpportunities: { items: [] },
    leadItem: null,
    shouldInterrupt: false,
    counts: { changes: 0, attention: 0, opportunities: 0 },
    complete: { isComplete: true, message: "No unresolved high-priority items remain. We'll continue monitoring your portfolio and notify you when something materially changes." },
    ...overrides,
  };
}

function viewModelFor(
  narrative: ReviewNarrative,
  todaysPriorities: MissionControlTodaysPrioritiesSummary = EMPTY_TODAYS_PRIORITIES,
  sinceLastReview: MissionControlSinceLastReviewSummary = TRACKING_INACTIVE_SINCE_LAST_REVIEW,
  opportunitiesGeneratedAt: string | null = null,
  // PO corrective round 4 (WA-0005 Defect 1): the Recommendation Service's
  // own real evaluation-lifecycle signal -- optional, defaulting to 'idle'/
  // null exactly as buildMissionControlViewModel.ts's own default does, so
  // every pre-existing call site in this file that doesn't pass these
  // continues to exercise the common "nothing newer in flight" case.
  opportunitiesEvaluationStatus: 'idle' | 'loading' | 'error' = 'idle',
  opportunitiesEvaluationError: string | null = null,
): MissionControlViewModel {
  return {
    state: 'loaded',
    narrative,
    generatedAt: FIXED_NOW,
    lastRefreshedAt: null,
    todaysPriorities,
    sinceLastReview,
    opportunitiesGeneratedAt,
    opportunitiesEvaluationStatus,
    opportunitiesEvaluationError,
  };
}

describe('MissionControl: non-loaded states', () => {
  it('renders a loading state with role=status', () => {
    const vm: MissionControlViewModel = {
      state: 'loading', narrative: null, generatedAt: FIXED_NOW, lastRefreshedAt: null,
      todaysPriorities: EMPTY_TODAYS_PRIORITIES, sinceLastReview: TRACKING_INACTIVE_SINCE_LAST_REVIEW,
      opportunitiesGeneratedAt: null,
    };
    render(<MissionControl viewModel={vm} th={THEMES.dark} />);
    // PO corrective round 3, Finding 1: the top-level "Preparing your
    // Review..." takeover AND the Ranked Opportunities section's own
    // Loading compact state (a real, threaded signal, not fabricated) both
    // use role="status" -- there are genuinely two now, so this asserts at
    // least one exists rather than exactly one.
    expect(screen.getAllByRole('status').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Preparing your Review…')).toBeInTheDocument();
  });

  it('WA-0005 Finding 1: the Ranked Opportunities section renders its own Loading compact state during the page-level loading state', () => {
    const vm: MissionControlViewModel = {
      state: 'loading', narrative: null, generatedAt: FIXED_NOW, lastRefreshedAt: null,
      todaysPriorities: EMPTY_TODAYS_PRIORITIES, sinceLastReview: TRACKING_INACTIVE_SINCE_LAST_REVIEW,
      opportunitiesGeneratedAt: null,
    };
    render(<MissionControl viewModel={vm} th={THEMES.dark} />);
    expect(screen.getByText(/ranked opportunities will appear here once ready/)).toBeInTheDocument();
  });

  it('WA-0005 Finding 1: the Ranked Opportunities section renders its own Unavailable compact state during the page-level error state', () => {
    const vm: MissionControlViewModel = {
      state: 'error', message: 'boom', narrative: null, generatedAt: FIXED_NOW, lastRefreshedAt: null,
      todaysPriorities: EMPTY_TODAYS_PRIORITIES, sinceLastReview: TRACKING_INACTIVE_SINCE_LAST_REVIEW,
      opportunitiesGeneratedAt: null,
    };
    render(<MissionControl viewModel={vm} th={THEMES.dark} />);
    expect(screen.getByText(/Ranked opportunities can't be confirmed right now/)).toBeInTheDocument();
  });

  it('renders an error state with role=alert and the given message', () => {
    const vm: MissionControlViewModel = {
      state: 'error', message: 'boom', narrative: null, generatedAt: FIXED_NOW, lastRefreshedAt: null,
      todaysPriorities: EMPTY_TODAYS_PRIORITIES, sinceLastReview: TRACKING_INACTIVE_SINCE_LAST_REVIEW,
      opportunitiesGeneratedAt: null,
    };
    render(<MissionControl viewModel={vm} th={THEMES.dark} />);
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
  });

  it('renders an unavailable state with its honest message', () => {
    const vm: MissionControlViewModel = {
      state: 'unavailable',
      message: 'Your Review is not available yet -- open Portfolio to load current positions and balances.',
      narrative: null,
      generatedAt: FIXED_NOW,
      lastRefreshedAt: null,
      todaysPriorities: EMPTY_TODAYS_PRIORITIES,
      sinceLastReview: TRACKING_INACTIVE_SINCE_LAST_REVIEW,
      opportunitiesGeneratedAt: null,
    };
    render(<MissionControl viewModel={vm} th={THEMES.dark} />);
    expect(screen.getByText(/not available yet/)).toBeInTheDocument();
  });
});

describe('MissionControl: narrative section order', () => {
  it('renders every narrative section, in the exact required order, on a loaded review', () => {
    render(<MissionControl viewModel={viewModelFor(narrativeFor())} th={THEMES.dark} />);

    const container = screen.getByLabelText('Command Center navigation').parentElement!;
    const sectionLabels = Array.from(container.querySelectorAll('[aria-label]')).map((el) => el.getAttribute('aria-label'));

    expect(sectionLabels).toEqual([
      'Command Center navigation',
      'Review Summary',
      'Portfolio Status',
      'Since Your Last Review',
      'Attention Required',
      'Ranked Opportunities',
      'Review Complete',
    ]);
  });
});

describe('MissionControl: first-viewport Summary Strip', () => {
  it('answers all three mission questions from the Summary Strip alone, on a quiet day, honestly reporting tracking-unavailable', () => {
    render(<MissionControl viewModel={viewModelFor(narrativeFor())} th={THEMES.dark} />);

    const strip = screen.getByLabelText('Review Summary');
    expect(strip).toHaveTextContent('Healthy');
    expect(strip).toHaveTextContent('82');
    expect(strip).toHaveTextContent('Nothing needs your immediate attention.');
    // WA-0004: today's real state -- never "Nothing changed since your last
    // review." while tracking is inactive.
    expect(strip).toHaveTextContent('Commitment tracking is not yet active.');
    expect(strip).not.toHaveTextContent('Nothing changed since your last review.');
  });

  it('surfaces the lead item headline when one exists', () => {
    const item = makeAttentionItem();
    const narrative = narrativeFor({
      attention: { items: [item] },
      leadItem: { kind: 'ATTENTION_ITEM', item },
      shouldInterrupt: true,
      counts: { changes: 0, attention: 1, opportunities: 0 },
      complete: { isComplete: false, message: '' },
    });
    render(<MissionControl viewModel={viewModelFor(narrative)} th={THEMES.dark} />);

    const strip = screen.getByLabelText('Review Summary');
    expect(strip).toHaveTextContent('Hold Position: AAPL reached 21 DTE target');
    expect(strip).toHaveTextContent('1 item needs your attention.');
  });
});

describe('MissionControl: WA-0003 reduced Attention Required section', () => {
  it('renders only lead item headline, open count, compact summary, and one deep link -- never a full per-item card list', () => {
    const queueItem = makeQueueItem();
    const todaysPriorities: MissionControlTodaysPrioritiesSummary = {
      leadItem: queueItem,
      openCount: 3,
      deepLink: `/portfolio?tab=todays-priorities&priority=${encodeURIComponent(queueItem.stableKey)}`,
    };
    render(<MissionControl viewModel={viewModelFor(narrativeFor(), todaysPriorities)} th={THEMES.dark} />);

    const section = screen.getByLabelText('Attention Required');
    expect(section).toHaveTextContent('Hold Position: AAPL reached 21 DTE target');
    expect(section).toHaveTextContent('3 items need your attention today.');
    // The full recommendedAction/detail text is Today's Priorities-only now.
    expect(section).not.toHaveTextContent('Close or roll before expiration.');
  });

  it('the deep link always targets Today\'s Priorities and never Positions or Decision History directly, for any item kind', () => {
    const kinds: TodaysPrioritiesQueueItem['kind'][] = ['attention', 'covered_call_opportunity', 'needs_follow_up'];
    for (const kind of kinds) {
      const queueItem = makeQueueItem({ kind, stableKey: `${kind}::stable-key` });
      const todaysPriorities: MissionControlTodaysPrioritiesSummary = {
        leadItem: queueItem,
        openCount: 1,
        deepLink: `/portfolio?tab=todays-priorities&priority=${encodeURIComponent(queueItem.stableKey)}`,
      };
      const { unmount } = render(<MissionControl viewModel={viewModelFor(narrativeFor(), todaysPriorities)} th={THEMES.dark} />);
      const link = screen.getByRole('link', { name: /open in today's priorities/i });
      const href = link.getAttribute('href')!;
      expect(href).toMatch(/^\/portfolio\?/);
      expect(href).toContain('tab=todays-priorities');
      expect(href).not.toMatch(/^\?/);
      expect(href).not.toMatch(/^\/dashboard\?/);
      expect(href).not.toContain('tab=positions');
      expect(href).not.toContain('tab=history');
      unmount();
    }
  });

  it('renders no Mark Complete/Reopen control and no deep link when there are no open items', () => {
    render(<MissionControl viewModel={viewModelFor(narrativeFor())} th={THEMES.dark} />);
    expect(screen.queryByRole('button', { name: /mark complete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reopen/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /open in today's priorities/i })).not.toBeInTheDocument();
  });
});

describe('WA-0004: MissionControl reduced "Since Your Last Review" section', () => {
  it('honestly reports the tracking-unavailable state -- never "Nothing changed since your last review." and never a zero count, but the deep link still renders', () => {
    render(<MissionControl viewModel={viewModelFor(narrativeFor())} th={THEMES.dark} />);

    const section = screen.getByLabelText('Since Your Last Review');
    expect(section).toHaveTextContent('Change tracking is not yet active.');
    expect(section).not.toHaveTextContent('Nothing changed since your last review.');
    expect(section).not.toHaveTextContent('0 things changed');
    expect(screen.getByRole('link', { name: /open in briefing/i })).toBeInTheDocument();
  });

  it('renders the genuine zero-change copy only when tracking is active and there are no changes', () => {
    const sinceLastReview: MissionControlSinceLastReviewSummary = {
      trackingActive: true, leadText: 'Nothing changed since your last review.', count: 0,
      summary: 'Nothing changed since your last review.', deepLink: '/portfolio?tab=briefing',
    };
    render(<MissionControl viewModel={viewModelFor(narrativeFor(), EMPTY_TODAYS_PRIORITIES, sinceLastReview)} th={THEMES.dark} />);

    const section = screen.getByLabelText('Since Your Last Review');
    expect(section).toHaveTextContent('Nothing changed since your last review.');
    expect(section).not.toHaveTextContent('Change tracking is not yet active.');
  });

  it('renders the lead change and count when tracking is active and changes exist', () => {
    const change = makeRevalidationResult();
    const sinceLastReview: MissionControlSinceLastReviewSummary = {
      trackingActive: true, leadText: change.commitment.subject.label, count: 1,
      summary: '1 thing changed since your last review.', deepLink: '/portfolio?tab=briefing',
    };
    render(<MissionControl viewModel={viewModelFor(narrativeFor(), EMPTY_TODAYS_PRIORITIES, sinceLastReview)} th={THEMES.dark} />);

    const section = screen.getByLabelText('Since Your Last Review');
    expect(section).toHaveTextContent('MSFT BPS');
    expect(section).toHaveTextContent('1 thing changed since your last review.');
    // The full whatChanged/whyItMatters detail is Briefing-only now.
    expect(section).not.toHaveTextContent('MSFT BPS reached 21 DTE.');
  });

  it('the deep link is exactly /portfolio?tab=briefing -- never a bare ?tab=briefing and never /dashboard?tab=briefing', () => {
    render(<MissionControl viewModel={viewModelFor(narrativeFor())} th={THEMES.dark} />);
    const link = screen.getByRole('link', { name: /open in briefing/i });
    const href = link.getAttribute('href')!;
    expect(href).toBe('/portfolio?tab=briefing');
    expect(href).toMatch(/^\/portfolio\?/);
    expect(href).not.toMatch(/^\?/);
    expect(href).not.toMatch(/^\/dashboard\?/);
  });
});

describe('MissionControl: empty-state copy for each section', () => {
  it('renders the required honest empty-state copy when nothing has changed and nothing needs attention', () => {
    render(<MissionControl viewModel={viewModelFor(narrativeFor())} th={THEMES.dark} />);

    expect(screen.getByText('Nothing needs your attention right now.')).toBeInTheDocument();
    // WA-0005: NewOpportunitiesSection no longer embeds BestOpportunitiesPanel
    // -- its own honest "nothing published this session" copy renders instead.
    expect(screen.getByText(/No current ranked opportunities/)).toBeInTheDocument();
  });
});

describe('MissionControl: real content renders end to end', () => {
  it('renders a real Attention Required item verbatim (Since Your Last Review\'s full detail is Briefing-only now)', () => {
    const change = makeRevalidationResult();
    const item = makeAttentionItem();
    const narrative = narrativeFor({
      sinceLastReview: { changes: [change] },
      attention: { items: [item] },
      leadItem: { kind: 'COMMITMENT_CHANGE', result: change },
      shouldInterrupt: true,
      counts: { changes: 1, attention: 1, opportunities: 0 },
      complete: { isComplete: false, message: '' },
    });
    const todaysPriorities: MissionControlTodaysPrioritiesSummary = {
      leadItem: makeQueueItem(),
      openCount: 1,
      deepLink: '/portfolio?tab=todays-priorities&priority=attention%3A%3AOBJ-X%3A%3Aposition%3A%3Apos_1',
    };
    const sinceLastReview: MissionControlSinceLastReviewSummary = {
      trackingActive: true, leadText: change.commitment.subject.label, count: 1,
      summary: '1 thing changed since your last review.', deepLink: '/portfolio?tab=briefing',
    };
    render(<MissionControl viewModel={viewModelFor(narrative, todaysPriorities, sinceLastReview)} th={THEMES.dark} />);

    expect(screen.getByLabelText('Since Your Last Review')).toHaveTextContent('MSFT BPS');
    // WA-0003: Attention Required now shows the shared queue's lead item
    // headline (todaysPriorities.leadItem), not narrative.attention.items --
    // deliberately, per the CES's ruling-6 parity requirement.
    expect(screen.getByLabelText('Attention Required')).toHaveTextContent('Hold Position: AAPL reached 21 DTE target');
  });
});

describe('MissionControl: Review Complete band', () => {
  it('renders the canonical complete message when the review is complete', () => {
    render(<MissionControl viewModel={viewModelFor(narrativeFor())} th={THEMES.dark} />);

    const band = screen.getByLabelText('Review Complete');
    expect(band).toHaveTextContent('No unresolved high-priority items remain.');
  });

  it('renders an honest, count-based closing message (never a fabricated one) when the review is not complete', () => {
    const item = makeAttentionItem();
    const narrative = narrativeFor({
      attention: { items: [item] },
      leadItem: { kind: 'ATTENTION_ITEM', item },
      shouldInterrupt: true,
      counts: { changes: 0, attention: 1, opportunities: 0 },
      complete: { isComplete: false, message: '' },
    });
    render(<MissionControl viewModel={viewModelFor(narrative)} th={THEMES.dark} />);

    const band = screen.getByLabelText('Review Complete');
    expect(band).toHaveTextContent("You've reached the end of this Review. 1 item above still needs your attention.");
  });
});

describe('MissionControl: read-only surface', () => {
  it('renders no control that submits, executes, replaces, or cancels a broker order', () => {
    render(<MissionControl viewModel={viewModelFor(narrativeFor())} th={THEMES.dark} />);

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    const forbidden = /submit|execute|place order|cancel order|replace order|buy|sell/i;
    for (const el of screen.queryAllByRole('link')) {
      expect(el.textContent ?? '').not.toMatch(forbidden);
    }
  });
});

// PO corrective round 4 (WA-0005 Defect 1): Mission Control previously had
// no way to receive the Ranked Opportunities lifecycle state at all --
// `reviewState` (threaded into NewOpportunitiesSection) came only from
// portfolio-composition loading/failure, never from the opportunities
// evaluation pipeline's own loading/refresh/failure state. These tests
// prove the corrected wiring end to end: MissionControlViewModel's new
// `opportunitiesEvaluationStatus`/`opportunitiesEvaluationError` fields
// reach NewOpportunitiesSection intact, for a REAL refresh-in-progress and
// a REAL evaluation-failure-with-stale-prior-results-preserved scenario --
// not just a prop-level simulation of a state that has no real code path.
describe('MissionControl: Ranked Opportunities lifecycle state now reaches Mission Control (WA-0005 Defect 1)', () => {
  it('genuine refresh-in-progress: opportunitiesEvaluationStatus="loading" on the view model surfaces a distinct banner while the last published Ranked Opportunities count remains visible', () => {
    const narrative = narrativeFor({
      newOpportunities: { items: [{ candidateId: 'c1', disposition: 'WATCH' } as any] },
    });
    const vm = viewModelFor(
      narrative,
      EMPTY_TODAYS_PRIORITIES,
      TRACKING_INACTIVE_SINCE_LAST_REVIEW,
      '2026-07-25T09:00:00.000Z',
      'loading',
    );
    render(<MissionControl viewModel={vm} th={THEMES.dark} />);

    const section = screen.getByLabelText('Ranked Opportunities');
    expect(section).toHaveTextContent('1 ranked opportunity to review');
    expect(section).toHaveTextContent('A newer ranked-opportunities evaluation is running');
  });

  it('genuine evaluation-failure-with-stale-prior-results-preserved: opportunitiesEvaluationStatus="error" surfaces the real error message while the last published Ranked Opportunities count remains visible, never blanked out', () => {
    const narrative = narrativeFor({
      newOpportunities: { items: [{ candidateId: 'c1', disposition: 'WATCH' } as any] },
    });
    const vm = viewModelFor(
      narrative,
      EMPTY_TODAYS_PRIORITIES,
      TRACKING_INACTIVE_SINCE_LAST_REVIEW,
      '2026-07-25T09:00:00.000Z',
      'error',
      'Recommendation engine unavailable.',
    );
    render(<MissionControl viewModel={vm} th={THEMES.dark} />);

    const section = screen.getByLabelText('Ranked Opportunities');
    expect(section).toHaveTextContent('1 ranked opportunity to review');
    expect(section).toHaveTextContent('The most recent ranked-opportunities evaluation attempt failed');
    expect(section).toHaveTextContent('Recommendation engine unavailable.');
  });

  it('the common case (opportunitiesEvaluationStatus omitted/"idle") renders neither banner -- no false positive', () => {
    const narrative = narrativeFor({
      newOpportunities: { items: [{ candidateId: 'c1', disposition: 'WATCH' } as any] },
    });
    render(<MissionControl viewModel={viewModelFor(narrative, EMPTY_TODAYS_PRIORITIES, TRACKING_INACTIVE_SINCE_LAST_REVIEW, '2026-07-25T09:00:00.000Z')} th={THEMES.dark} />);

    const section = screen.getByLabelText('Ranked Opportunities');
    expect(section).not.toHaveTextContent('A newer ranked-opportunities evaluation is running');
    expect(section).not.toHaveTextContent('The most recent ranked-opportunities evaluation attempt failed');
  });
});
