// features/portfolio/todaysPriorities/__tests__/TodaysPrioritiesQueueView.test.tsx
//
// WA-0003: coverage for the new Today's Priorities workspace -- completion
// workflow (Mark Complete / Reopen / persistence / shared state with
// priorityWorkflowState.ts's storage key), completed-section behavior
// (collapsed by default, count, empty state, reopen), non-completability of
// covered-call/needsFollowUp kinds, and level-1 deep-link resolution
// (exact stableKey match, highlight, fail-safe notice, same-position/
// different-kind disambiguation).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { THEMES } from '@/lib/theme';
import { TodaysPrioritiesQueueView } from '../TodaysPrioritiesQueueView';
import { buildTodaysPrioritiesQueue } from '@/lib/todays-priorities-queue';
import { PRIORITY_WORKFLOW_STORAGE_KEY, getPriorityWorkflowKey } from '@/features/portfolio/priorities/priorityWorkflowState';
import type { PortfolioObjective } from '@/lib/portfolio-intelligence';
import type { PrioritizedObjective, TodaysPrioritiesDashboard, CoveredCallOpportunityInput } from '@/lib/todaysPriorities';
import type { DecisionReview } from '@/lib/decision-review';

let objectiveCounter = 0;

function makeObjective(overrides: Partial<PortfolioObjective> = {}): PortfolioObjective {
  objectiveCounter += 1;
  return {
    id: `obj_${objectiveCounter}`,
    createdAt: '2026-07-24T12:00:00.000Z',
    version: 'portfolio-objective-v1',
    type: 'MANAGE_POSITION',
    ruleId: 'OBJ-WATCH-POSITION',
    title: 'Hold Position: TEST',
    summary: 'Test summary.',
    priority: 'medium',
    urgency: 'today',
    actionability: 'ACTION_NEEDED',
    confidence: 80,
    status: 'active',
    source: 'position',
    subject: { type: 'position', id: 'pos_test', symbol: 'TEST', label: 'TEST position' },
    rationale: 'Hold the position; no material change in evidence.',
    supportingEvidence: [],
    concerns: [],
    portfolioImpact: { direction: 'neutral', magnitude: 'low', explanation: '' },
    incomeImpact: { direction: 'neutral', magnitude: 'low', explanation: '' },
    riskImpact: { direction: 'neutral', magnitude: 'low', explanation: '' },
    capitalImpact: { direction: 'neutral', magnitude: 'low', explanation: '' },
    reviewTriggers: [],
    metadata: { executionAllowed: false, paperExecutionAllowed: false, rulesEvaluated: [], rulesTriggered: [] },
    ...overrides,
  };
}

function makePrioritized(overrides: Partial<PrioritizedObjective> = {}): PrioritizedObjective {
  return { objective: makeObjective(), score: 50, tier: 'Medium', reasons: ['Test reason'], ...overrides };
}

function makeReview(overrides: Partial<DecisionReview> = {}): DecisionReview {
  return {
    id: 'review_1',
    positionId: 'pos_review',
    symbol: 'AMD',
    strategy: 'CSP',
    recommendedAt: '2026-07-01T00:00:00.000Z',
    evidence: {
      managementIntent: 'HOLD_POSITION', label: 'Hold Position', primaryReason: 'test', reasons: [],
      confidence: 60, winnerScore: null, runnerUpIntent: null, runnerUpScore: null, margin: null, confidenceTier: null,
    },
    traderAction: null, traderActionAt: null, outcomeStatus: 'PENDING', realizedPnl: null, notes: '',
    createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeCoveredCall(overrides: Partial<CoveredCallOpportunityInput> = {}): CoveredCallOpportunityInput {
  return { key: 'AMD::stock', symbol: 'AMD', shares: 100, ...overrides };
}

function makeDashboard(overrides: Partial<TodaysPrioritiesDashboard> = {}): TodaysPrioritiesDashboard {
  return {
    immediateAction: [],
    reviewToday: { mediumPriority: [], earningsReviews: [], expiringPositions: [], needsFollowUp: [] },
    monitor: [],
    opportunities: { rollOpportunities: [], coveredCallOpportunities: [], cspOpportunities: [], screenerCandidatesAvailable: false },
    ...overrides,
  };
}

const GENERATED_AT = '2026-07-24T15:00:00.000Z';

function setUrl(search: string) {
  window.history.pushState({}, '', `/portfolio${search}`);
}

beforeEach(() => {
  localStorage.clear();
  setUrl('');
});

afterEach(() => {
  localStorage.clear();
});

describe('TodaysPrioritiesQueueView: empty states', () => {
  it('offers Refresh Quotes on the primary Today’s Priorities Verify Pricing item', async () => {
    const quoteCapturedAt = '2026-08-10T20:00:00.000Z';
    const user = userEvent.setup();
    const objective = makeObjective({ ruleId: 'OBJ-VERIFY-PRICING', title: 'Verify Pricing: TEST' });
    const dashboard = makeDashboard({ immediateAction: [makePrioritized({ objective, score: 90 })] });
    const queue = buildTodaysPrioritiesQueue({ dashboard, generatedAt: GENERATED_AT });
    const onRefreshQuotes = vi.fn().mockResolvedValue({
      status: 'success',
      positions: [{ key: 'pos_test', recommendation: { kind: 'verify-pricing' }, pricingDecisionEvidence: { marketableDecisionEligible: false, marketableQuoteCapturedAt: quoteCapturedAt } }],
    });
    const onPricingRefreshOutcome = vi.fn();
    render(
      <TodaysPrioritiesQueueView
        queue={queue}
        loading={false}
        th={THEMES.dark}
        onRefreshQuotes={onRefreshQuotes}
        portfolioRefreshing={false}
        onPricingRefreshOutcome={onPricingRefreshOutcome}
        quoteCapturedAtByPositionKey={{ pos_test: quoteCapturedAt }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /refresh quotes/i }));
    expect(onRefreshQuotes).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onPricingRefreshOutcome).toHaveBeenLastCalledWith(expect.objectContaining({ message: expect.stringContaining('broker quote timestamp did not advance') })));
  });

  it('shows "Nothing needs your attention right now." when the open queue is empty', () => {
    const queue = buildTodaysPrioritiesQueue({ dashboard: makeDashboard(), generatedAt: GENERATED_AT });
    render(<TodaysPrioritiesQueueView queue={queue} loading={false} th={THEMES.dark} />);
    expect(screen.getByText('Nothing needs your attention right now.')).toBeInTheDocument();
  });

  it('renders no Completed section when nothing is completed', () => {
    const objective = makeObjective();
    const dashboard = makeDashboard({ immediateAction: [makePrioritized({ objective, score: 80 })] });
    const queue = buildTodaysPrioritiesQueue({ dashboard, generatedAt: GENERATED_AT });
    render(<TodaysPrioritiesQueueView queue={queue} loading={false} th={THEMES.dark} />);
    expect(screen.queryByRole('region', { name: 'Completed Priorities' })).not.toBeInTheDocument();
  });
});

describe('TodaysPrioritiesQueueView: Mark Complete / Reopen', () => {
  it('Mark Complete persists to the shared hunter-priorities-workflow-state localStorage key', async () => {
    const user = userEvent.setup();
    const objective = makeObjective({ ruleId: 'OBJ-CLOSE-FOR-PROFIT' });
    const dashboard = makeDashboard({ immediateAction: [makePrioritized({ objective, score: 80 })] });
    const queue = buildTodaysPrioritiesQueue({ dashboard, generatedAt: GENERATED_AT });
    render(<TodaysPrioritiesQueueView queue={queue} loading={false} th={THEMES.dark} />);

    await user.click(screen.getByRole('button', { name: /mark complete/i }));

    const stored = JSON.parse(localStorage.getItem(PRIORITY_WORKFLOW_STORAGE_KEY)!);
    expect(stored[getPriorityWorkflowKey(objective)]).toBeDefined();
    expect(screen.getByText('Nothing needs your attention right now.')).toBeInTheDocument();
  });

  it('Completed section is collapsed by default, shows correct count, expands to reveal Reopen', async () => {
    const user = userEvent.setup();
    const objective = makeObjective({ ruleId: 'OBJ-MANAGE-21-DTE' });
    localStorage.setItem(
      PRIORITY_WORKFLOW_STORAGE_KEY,
      JSON.stringify({
        [getPriorityWorkflowKey(objective)]: { completedAt: '2026-07-20T00:00:00.000Z', fingerprint: [objective.priority, objective.urgency, objective.actionability, objective.summary, ''].join('::') },
      }),
    );
    const dashboard = makeDashboard({ immediateAction: [makePrioritized({ objective, score: 80 })] });
    const queue = buildTodaysPrioritiesQueue({ dashboard, generatedAt: GENERATED_AT });
    render(<TodaysPrioritiesQueueView queue={queue} loading={false} th={THEMES.dark} />);

    const header = await screen.findByRole('button', { name: /completed priorities/i });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(within(header).getByText('1 item')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reopen/i })).not.toBeInTheDocument();

    await user.click(header);
    expect(screen.getByRole('button', { name: /reopen/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /reopen/i }));
    const stored = JSON.parse(localStorage.getItem(PRIORITY_WORKFLOW_STORAGE_KEY)!);
    expect(stored[getPriorityWorkflowKey(objective)]).toBeUndefined();
  });

  it('never renders Mark Complete for covered_call_opportunity or needs_follow_up items', () => {
    const cc = makeCoveredCall();
    const review = makeReview();
    const dashboard = makeDashboard({
      opportunities: { rollOpportunities: [], coveredCallOpportunities: [cc], cspOpportunities: [], screenerCandidatesAvailable: false },
      reviewToday: { mediumPriority: [], earningsReviews: [], expiringPositions: [], needsFollowUp: [review] },
    });
    const queue = buildTodaysPrioritiesQueue({ dashboard, generatedAt: GENERATED_AT });
    render(<TodaysPrioritiesQueueView queue={queue} loading={false} th={THEMES.dark} />);
    expect(screen.queryByRole('button', { name: /mark complete/i })).not.toBeInTheDocument();
  });
});

describe('TodaysPrioritiesQueueView: level-1 deep-link resolution', () => {
  it('exact stableKey match highlights the matching item, for an attention item', async () => {
    const objective = makeObjective({ ruleId: 'OBJ-WATCH-POSITION' });
    const dashboard = makeDashboard({ immediateAction: [makePrioritized({ objective, score: 80 })] });
    const queue = buildTodaysPrioritiesQueue({ dashboard, generatedAt: GENERATED_AT });
    setUrl(`?tab=todays-priorities&priority=${encodeURIComponent(queue.orderedItems[0].stableKey)}`);

    render(<TodaysPrioritiesQueueView queue={queue} loading={false} th={THEMES.dark} />);
    // Expanded PriorityCard reveals "Recommendation" section text.
    expect(await screen.findByText('Recommendation')).toBeInTheDocument();
  });

  it('renders a dismissible "no longer open" notice when the target has completed', () => {
    const objective = makeObjective({ ruleId: 'OBJ-CLOSE-LOSER' });
    localStorage.setItem(
      PRIORITY_WORKFLOW_STORAGE_KEY,
      JSON.stringify({
        [getPriorityWorkflowKey(objective)]: { completedAt: '2026-07-20T00:00:00.000Z', fingerprint: [objective.priority, objective.urgency, objective.actionability, objective.summary, ''].join('::') },
      }),
    );
    const dashboard = makeDashboard({ immediateAction: [makePrioritized({ objective, score: 80 })] });
    const queue = buildTodaysPrioritiesQueue({ dashboard, generatedAt: GENERATED_AT });
    setUrl(`?tab=todays-priorities&priority=${encodeURIComponent(queue.orderedItems[0].stableKey)}`);

    render(<TodaysPrioritiesQueueView queue={queue} loading={false} th={THEMES.dark} />);
    expect(screen.getByText('This priority is no longer open.')).toBeInTheDocument();
  });

  it('renders a "no longer open" notice for a stale/nonexistent stableKey, never crashes', () => {
    const dashboard = makeDashboard();
    const queue = buildTodaysPrioritiesQueue({ dashboard, generatedAt: GENERATED_AT });
    setUrl(`?tab=todays-priorities&priority=${encodeURIComponent('attention::NOPE::position::none')}`);

    render(<TodaysPrioritiesQueueView queue={queue} loading={false} th={THEMES.dark} />);
    expect(screen.getByText('This priority is no longer open.')).toBeInTheDocument();
  });

  it('disambiguates an attention item and a covered-call opportunity sharing the same position key -- each resolves to its own distinct target', async () => {
    const sharedKey = 'AMD::stock';
    const objective = makeObjective({ ruleId: 'OBJ-ASSIGNMENT-RISK', subject: { type: 'position', id: sharedKey, symbol: 'AMD', label: 'AMD' } });
    const cc = makeCoveredCall({ key: sharedKey, symbol: 'AMD' });
    const dashboard = makeDashboard({
      immediateAction: [makePrioritized({ objective, score: 80 })],
      opportunities: { rollOpportunities: [], coveredCallOpportunities: [cc], cspOpportunities: [], screenerCandidatesAvailable: false },
    });
    const queue = buildTodaysPrioritiesQueue({ dashboard, generatedAt: GENERATED_AT });
    const ccItem = queue.orderedItems.find((i) => i.kind === 'covered_call_opportunity')!;
    setUrl(`?tab=todays-priorities&priority=${encodeURIComponent(ccItem.stableKey)}`);

    render(<TodaysPrioritiesQueueView queue={queue} loading={false} th={THEMES.dark} />);
    // No fail-safe notice should render -- the CC item's own stableKey resolves distinctly.
    expect(screen.queryByText('This priority is no longer open.')).not.toBeInTheDocument();
  });

  it('the notice is dismissible', async () => {
    const user = userEvent.setup();
    const dashboard = makeDashboard();
    const queue = buildTodaysPrioritiesQueue({ dashboard, generatedAt: GENERATED_AT });
    setUrl(`?tab=todays-priorities&priority=${encodeURIComponent('attention::NOPE::position::none')}`);

    render(<TodaysPrioritiesQueueView queue={queue} loading={false} th={THEMES.dark} />);
    await user.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByText('This priority is no longer open.')).not.toBeInTheDocument();
  });
});

describe('TodaysPrioritiesQueueView: level-2 destination links', () => {
  it('a position-linked attention item links to ?tab=positions&focus=<pos.key>', () => {
    const objective = makeObjective({ ruleId: 'OBJ-ROLL-POSITION', subject: { type: 'position', id: 'AMD::2026-08-21', symbol: 'AMD', label: 'AMD' } });
    const dashboard = makeDashboard({ immediateAction: [makePrioritized({ objective, score: 80 })] });
    const queue = buildTodaysPrioritiesQueue({ dashboard, generatedAt: GENERATED_AT });
    render(<TodaysPrioritiesQueueView queue={queue} loading={false} th={THEMES.dark} />);
    const link = screen.getByRole('link', { name: /open position/i });
    expect(link).toHaveAttribute('href', `?tab=positions&focus=${encodeURIComponent('AMD::2026-08-21')}`);
  });

  it('a portfolio-level attention item (no subjectId) links to unfocused ?tab=positions', () => {
    const objective = makeObjective({ ruleId: 'OBJ-PRESERVE-BUYING-POWER', type: 'PRESERVE_BUYING_POWER', subject: { type: 'portfolio', id: null, symbol: null, label: 'Portfolio' } as any });
    const dashboard = makeDashboard({ immediateAction: [makePrioritized({ objective, score: 80 })] });
    const queue = buildTodaysPrioritiesQueue({ dashboard, generatedAt: GENERATED_AT });
    render(<TodaysPrioritiesQueueView queue={queue} loading={false} th={THEMES.dark} />);
    const link = screen.getByRole('link', { name: /open positions/i });
    expect(link).toHaveAttribute('href', '?tab=positions');
  });

  it('a needsFollowUp item links to ?tab=history&reviewId=<id>, not Positions', () => {
    const review = makeReview({ id: 'review_xyz' });
    const dashboard = makeDashboard({ reviewToday: { mediumPriority: [], earningsReviews: [], expiringPositions: [], needsFollowUp: [review] } });
    const queue = buildTodaysPrioritiesQueue({ dashboard, generatedAt: GENERATED_AT });
    render(<TodaysPrioritiesQueueView queue={queue} loading={false} th={THEMES.dark} />);
    const link = screen.getByRole('link', { name: /decision history/i });
    expect(link).toHaveAttribute('href', `?tab=history&reviewId=${encodeURIComponent('review_xyz')}`);
  });

  it('a covered-call opportunity links to ?tab=positions&focus=<opp.key>', () => {
    const cc = makeCoveredCall({ key: 'AMD::stock' });
    const dashboard = makeDashboard({ opportunities: { rollOpportunities: [], coveredCallOpportunities: [cc], cspOpportunities: [], screenerCandidatesAvailable: false } });
    const queue = buildTodaysPrioritiesQueue({ dashboard, generatedAt: GENERATED_AT });
    render(<TodaysPrioritiesQueueView queue={queue} loading={false} th={THEMES.dark} />);
    const link = screen.getByRole('link', { name: /open position/i });
    expect(link).toHaveAttribute('href', `?tab=positions&focus=${encodeURIComponent('AMD::stock')}`);
  });
});
