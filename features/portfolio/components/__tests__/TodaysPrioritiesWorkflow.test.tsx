// features/portfolio/components/__tests__/TodaysPrioritiesWorkflow.test.tsx
//
// PI-0004C: component-level coverage for the Today's Priorities workflow
// subpage (Mark Complete / Reopen / persistence / auto-reopen). Mirrors
// TodaysPriorities.test.tsx's style and fixture shape.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { THEMES } from '@/lib/theme';
import { TodaysPrioritiesWorkflow } from '../TodaysPrioritiesWorkflow';
import { PRIORITY_WORKFLOW_STORAGE_KEY } from '../../priorities/priorityWorkflowState';
import type { PortfolioObjective } from '@/lib/portfolio-intelligence';

function makeObjective(overrides: Partial<PortfolioObjective> = {}): PortfolioObjective {
  return {
    id: `obj_${Math.random().toString(36).slice(2, 9)}`,
    createdAt: '2026-07-12T00:00:00.000Z',
    version: 'portfolio-objective-v1',
    type: 'REVIEW_THREATENED_POSITION',
    ruleId: 'OBJ-EARNINGS-RISK',
    title: 'Earnings Risk: AMD',
    summary: 'Upcoming earnings before expiration.',
    priority: 'high',
    urgency: 'today',
    actionability: 'ACTION_NEEDED',
    confidence: 86,
    status: 'active',
    source: 'position',
    subject: { type: 'position', id: 'pos_amd', symbol: 'AMD', label: 'AMD BPS position' },
    rationale: 'Decide whether to close, reduce risk, or hold through earnings.',
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
    id: 'obj_wait', type: 'WAIT', ruleId: 'OBJ-WAIT', title: 'No action required', priority: 'informational',
    urgency: 'none', actionability: 'MONITOR', subject: { type: 'portfolio', label: 'Portfolio' },
  });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PI-0004C: TodaysPrioritiesWorkflow -- Open/Completed sections', () => {
  it('offers the canonical quote refresh directly on a Verify Pricing priority', async () => {
    const user = userEvent.setup();
    const onRefreshQuotes = vi.fn().mockResolvedValue({
      status: 'success',
      positions: [{ key: 'pos_amd', recommendation: { kind: 'watch' }, pricingDecisionEvidence: { marketableDecisionEligible: true } }],
    });
    const onPricingRefreshOutcome = vi.fn();
    const objective = makeObjective({
      type: 'MANAGE_POSITION',
      ruleId: 'OBJ-VERIFY-PRICING',
      title: 'Verify Pricing: AMD',
    });
    render(
      <TodaysPrioritiesWorkflow
        objectives={[objective]}
        loading={false}
        th={THEMES.dark}
        onRefreshQuotes={onRefreshQuotes}
        portfolioRefreshing={false}
        onPricingRefreshOutcome={onPricingRefreshOutcome}
      />,
    );

    await user.click(screen.getByRole('button', { name: /refresh quotes/i }));
    expect(onRefreshQuotes).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onPricingRefreshOutcome).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'Pricing verified; recommendation updated.' })));
    expect(screen.queryByRole('button', { name: 'Mark Complete' })).not.toBeInTheDocument();
  });

  it('renders everything under Open Priorities when nothing is completed', () => {
    render(<TodaysPrioritiesWorkflow objectives={[makeObjective()]} loading={false} th={THEMES.dark} />);
    expect(screen.getByText('Open Priorities')).toBeInTheDocument();
    expect(screen.queryByText('Completed Priorities')).not.toBeInTheDocument();
    expect(screen.getByText('Earnings Risk: AMD')).toBeInTheDocument();
  });

  it('Mark Complete moves an item from Open into Completed', async () => {
    const user = userEvent.setup();
    render(<TodaysPrioritiesWorkflow objectives={[makeObjective()]} loading={false} th={THEMES.dark} />);

    await user.click(screen.getByRole('button', { name: 'Mark Complete' }));

    expect(screen.getByText('Completed Priorities')).toBeInTheDocument();
    const completedSection = within(screen.getByText('Completed Priorities').closest('section')!);
    expect(completedSection.getByText('Earnings Risk: AMD')).toBeInTheDocument();

    const openSection = within(screen.getByText('Open Priorities').closest('section')!);
    expect(openSection.queryByText('Earnings Risk: AMD')).not.toBeInTheDocument();
  });

  it('Reopen returns a completed item to Open', async () => {
    const user = userEvent.setup();
    render(<TodaysPrioritiesWorkflow objectives={[makeObjective()]} loading={false} th={THEMES.dark} />);

    await user.click(screen.getByRole('button', { name: 'Mark Complete' }));
    await user.click(screen.getByRole('button', { name: 'Reopen' }));

    expect(screen.queryByText('Completed Priorities')).not.toBeInTheDocument();
    const openSection = within(screen.getByText('Open Priorities').closest('section')!);
    expect(openSection.getByText('Earnings Risk: AMD')).toBeInTheDocument();
  });

  it('completed items remain expandable to review the original recommendation', async () => {
    const user = userEvent.setup();
    render(<TodaysPrioritiesWorkflow objectives={[makeObjective()]} loading={false} th={THEMES.dark} />);
    await user.click(screen.getByRole('button', { name: 'Mark Complete' }));

    const completedSection = within(screen.getByText('Completed Priorities').closest('section')!);
    await user.click(completedSection.getByRole('button', { name: /Earnings Risk: AMD/ }));
    expect(completedSection.getByText('Recommendation')).toBeInTheDocument();
  });
});

describe('PI-0004C: WAIT cannot be completed', () => {
  it('renders no Mark Complete button for a WAIT-only list', () => {
    render(<TodaysPrioritiesWorkflow objectives={[makeWait()]} loading={false} th={THEMES.dark} />);
    expect(screen.queryByRole('button', { name: 'Mark Complete' })).not.toBeInTheDocument();
  });
});

describe('PI-0004C: ordering', () => {
  it('preserves canonical ordering of Open Priorities (no re-sorting)', () => {
    const low = makeObjective({ id: 'low', priority: 'low', title: 'Low priority item', subject: { type: 'position', id: 'pos_low', symbol: 'MU', label: 'MU' } });
    const critical = makeObjective({ id: 'critical', priority: 'critical', title: 'Critical priority item', subject: { type: 'position', id: 'pos_crit', symbol: 'NVDA', label: 'NVDA' } });
    render(<TodaysPrioritiesWorkflow objectives={[low, critical]} loading={false} th={THEMES.dark} />);

    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['Low priority item', 'Critical priority item']);
  });

  it('sorts Completed Priorities newest-completed-first', async () => {
    const user = userEvent.setup();
    const first = makeObjective({ id: 'first', title: 'First completed', subject: { type: 'position', id: 'pos_first', symbol: 'AMD', label: 'AMD' } });
    const second = makeObjective({ id: 'second', title: 'Second completed', subject: { type: 'position', id: 'pos_second', symbol: 'NVDA', label: 'NVDA' } });

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-11T00:00:00.000Z'));
    const { rerender } = render(<TodaysPrioritiesWorkflow objectives={[first, second]} loading={false} th={THEMES.dark} />);
    await user.click(screen.getAllByRole('button', { name: 'Mark Complete' })[0]); // completes "first" at 07-11

    vi.setSystemTime(new Date('2026-07-12T00:00:00.000Z'));
    rerender(<TodaysPrioritiesWorkflow objectives={[first, second]} loading={false} th={THEMES.dark} />);
    await user.click(screen.getByRole('button', { name: 'Mark Complete' })); // completes "second" at 07-12

    const completedSection = within(screen.getByText('Completed Priorities').closest('section')!);
    const headings = completedSection.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['Second completed', 'First completed']);
  });
});

describe('PI-0004C: persistence', () => {
  it('completion persists across a remount (simulated page refresh)', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<TodaysPrioritiesWorkflow objectives={[makeObjective()]} loading={false} th={THEMES.dark} />);
    await user.click(screen.getByRole('button', { name: 'Mark Complete' }));
    expect(screen.getByText('Completed Priorities')).toBeInTheDocument();
    unmount();

    render(<TodaysPrioritiesWorkflow objectives={[makeObjective()]} loading={false} th={THEMES.dark} />);
    expect(await screen.findByText('Completed Priorities')).toBeInTheDocument();
  });

  it('writes to the documented localStorage key', async () => {
    const user = userEvent.setup();
    render(<TodaysPrioritiesWorkflow objectives={[makeObjective()]} loading={false} th={THEMES.dark} />);
    await user.click(screen.getByRole('button', { name: 'Mark Complete' }));
    expect(localStorage.getItem(PRIORITY_WORKFLOW_STORAGE_KEY)).not.toBeNull();
  });
});

describe('PI-0004C: material change reopens completed items', () => {
  it('reopens a completed item once its priority materially increases', async () => {
    const user = userEvent.setup();
    const original = makeObjective({ id: 'orig', priority: 'high' });
    const { rerender } = render(<TodaysPrioritiesWorkflow objectives={[original]} loading={false} th={THEMES.dark} />);
    await user.click(screen.getByRole('button', { name: 'Mark Complete' }));
    expect(screen.getByText('Completed Priorities')).toBeInTheDocument();

    // Same key (ruleId + subject), escalated priority -- a fresh evaluation
    // run producing a new id/createdAt but materially different substance.
    const escalated = makeObjective({ id: 'orig-escalated', priority: 'critical' });
    rerender(<TodaysPrioritiesWorkflow objectives={[escalated]} loading={false} th={THEMES.dark} />);

    expect(await screen.findByText('Earnings Risk: AMD')).toBeInTheDocument();
    expect(screen.queryByText('Completed Priorities')).not.toBeInTheDocument();
    const openSection = within(screen.getByText('Open Priorities').closest('section')!);
    expect(openSection.getByText('Earnings Risk: AMD')).toBeInTheDocument();
  });

  it('does NOT reopen on a plain refresh where nothing materially changed (new id/createdAt only)', async () => {
    const user = userEvent.setup();
    const original = makeObjective({ id: 'orig', createdAt: '2026-07-11T00:00:00.000Z' });
    const { rerender } = render(<TodaysPrioritiesWorkflow objectives={[original]} loading={false} th={THEMES.dark} />);
    await user.click(screen.getByRole('button', { name: 'Mark Complete' }));

    const refreshed = makeObjective({ id: 'orig-refreshed', createdAt: '2026-07-12T09:00:00.000Z' });
    rerender(<TodaysPrioritiesWorkflow objectives={[refreshed]} loading={false} th={THEMES.dark} />);

    expect(screen.getByText('Completed Priorities')).toBeInTheDocument();
    expect(screen.queryByText('Open Priorities')).toBeInTheDocument(); // section header itself always renders
    const openSection = within(screen.getByText('Open Priorities').closest('section')!);
    expect(openSection.queryByText('Earnings Risk: AMD')).not.toBeInTheDocument();
  });
});

describe('PI-0004C: does not touch Portfolio Intelligence', () => {
  it('marking complete does not mutate the objective object passed in', async () => {
    const user = userEvent.setup();
    const objective = makeObjective({ id: 'a' });
    const snapshot = JSON.parse(JSON.stringify(objective));
    render(<TodaysPrioritiesWorkflow objectives={[objective]} loading={false} th={THEMES.dark} />);
    await user.click(screen.getByRole('button', { name: 'Mark Complete' }));
    expect(objective).toEqual(snapshot);
  });

  it('does not import or call any Portfolio Intelligence evaluation function', async () => {
    const fs = await import('node:fs/promises');
    const text = await fs.readFile('features/portfolio/components/TodaysPrioritiesWorkflow.tsx', 'utf-8');
    expect(text).not.toContain('evaluatePortfolioObjectives');
    expect(text).not.toContain('evaluatePositionObjective');
    expect(text).not.toContain('prioritizePortfolioObjectives');
  });
});

describe('PI-0004C: loading/null passthrough', () => {
  it('shows a loading placeholder when objectives is null and loading is true', () => {
    render(<TodaysPrioritiesWorkflow objectives={null} loading={true} th={THEMES.dark} />);
    expect(screen.getByText(/Loading priorities/)).toBeInTheDocument();
  });

  it('renders nothing when objectives is null and not loading', () => {
    const { container } = render(<TodaysPrioritiesWorkflow objectives={null} loading={false} th={THEMES.dark} />);
    expect(container).toBeEmptyDOMElement();
  });
});
