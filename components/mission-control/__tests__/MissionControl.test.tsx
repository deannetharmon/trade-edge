// components/mission-control/__tests__/MissionControl.test.tsx
//
// MB-0002: component-level coverage for the Mission Control layout.
// Verifies: narrative sections render in the exact required order on every
// render (order is DOM order, not CSS -- see MissionControl.tsx's module
// doc); the first-viewport Summary Strip answers all three mission
// questions without needing any of the sections below; each non-loaded
// state (loading/error/unavailable) renders its own honest, distinct
// message; empty-state copy for each narrative section renders through real
// components; the completion band renders both the complete and
// not-complete cases; and the whole surface remains strictly read-only.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { THEMES } from '@/lib/theme';
import { MissionControl } from '../MissionControl';
import type { MissionControlViewModel, MissionControlTodaysPrioritiesSummary } from '@/lib/mission-control';
import type { ReviewNarrative } from '@/lib/review-conductor';
import type { AttentionItem } from '@/lib/morning-briefing';
import type { RevalidationResult } from '@/lib/revalidation';
import type { TodaysPrioritiesQueueItem } from '@/lib/todays-priorities-queue';
import { createTraderCommitment } from '@/lib/trader-commitments';

const EMPTY_TODAYS_PRIORITIES: MissionControlTodaysPrioritiesSummary = { leadItem: null, openCount: 0, deepLink: null };

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

function viewModelFor(narrative: ReviewNarrative, todaysPriorities: MissionControlTodaysPrioritiesSummary = EMPTY_TODAYS_PRIORITIES): MissionControlViewModel {
  return { state: 'loaded', narrative, generatedAt: FIXED_NOW, lastRefreshedAt: null, todaysPriorities };
}

describe('MissionControl: non-loaded states', () => {
  it('renders a loading state with role=status', () => {
    const vm: MissionControlViewModel = { state: 'loading', narrative: null, generatedAt: FIXED_NOW, lastRefreshedAt: null, todaysPriorities: EMPTY_TODAYS_PRIORITIES };
    render(<MissionControl viewModel={vm} th={THEMES.dark} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders an error state with role=alert and the given message', () => {
    const vm: MissionControlViewModel = { state: 'error', message: 'boom', narrative: null, generatedAt: FIXED_NOW, lastRefreshedAt: null, todaysPriorities: EMPTY_TODAYS_PRIORITIES };
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
      'New Opportunities',
      'Review Complete',
    ]);
  });
});

describe('MissionControl: first-viewport Summary Strip', () => {
  it('answers all three mission questions from the Summary Strip alone, on a quiet day', () => {
    render(<MissionControl viewModel={viewModelFor(narrativeFor())} th={THEMES.dark} />);

    const strip = screen.getByLabelText('Review Summary');
    expect(strip).toHaveTextContent('Healthy');
    expect(strip).toHaveTextContent('82');
    expect(strip).toHaveTextContent('Nothing needs your immediate attention.');
    expect(strip).toHaveTextContent('Nothing changed since your last review.');
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

describe('MissionControl: empty-state copy for each section', () => {
  it('renders the required honest empty-state copy when nothing has changed and nothing needs attention', () => {
    render(<MissionControl viewModel={viewModelFor(narrativeFor())} th={THEMES.dark} />);

    expect(screen.getAllByText('Nothing changed since your last review.').length).toBeGreaterThan(0);
    expect(screen.getByText('Nothing needs your attention right now.')).toBeInTheDocument();
    expect(screen.getByText('No ranked opportunities to display.')).toBeInTheDocument();
  });
});

describe('MissionControl: real content renders end to end', () => {
  it('renders a real Since Your Last Review change and a real Attention Required item verbatim', () => {
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
    render(<MissionControl viewModel={viewModelFor(narrative, todaysPriorities)} th={THEMES.dark} />);

    // "MSFT BPS reached 21 DTE." legitimately appears twice: once as the
    // Summary Strip's Lead Item preview, once in the full Since Your Last
    // Review section below -- the same canonical field rendered at two
    // narrative depths, not a bug.
    expect(screen.getAllByText('MSFT BPS reached 21 DTE.').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText('Since Your Last Review')).toHaveTextContent('MSFT BPS reached 21 DTE.');
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
