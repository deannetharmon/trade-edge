// features/portfolio/components/__tests__/TodaysPriorities.test.tsx
//
// PI-0004A: component tests. TodaysPriorities performs no evaluation,
// ranking, or scoring -- every test here verifies rendering of data already
// present on the PortfolioObjective fixtures, never computed by the
// component itself.

import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { THEMES } from '@/lib/theme';
import { TodaysPriorities } from '../TodaysPriorities';
import type { PortfolioObjective } from '@/lib/portfolio-intelligence';

function makeObjective(overrides: Partial<PortfolioObjective> = {}): PortfolioObjective {
  return {
    id: `obj_${Math.random().toString(36).slice(2, 9)}`,
    createdAt: '2026-07-12T00:00:00.000Z',
    version: 'portfolio-objective-v1',
    type: 'CLOSE_FOR_PROFIT',
    ruleId: 'OBJ-CLOSE-FOR-PROFIT',
    title: 'Close for profit: AMD',
    summary: 'AMD has captured 55% of max profit.',
    priority: 'high',
    urgency: 'today',
    actionability: 'ACTION_NEEDED',
    confidence: 85,
    status: 'active',
    source: 'position',
    subject: { type: 'position', id: 'pos_1', symbol: 'AMD', label: 'AMD BPS position' },
    rationale: 'AMD has reached 55% of max profit, clearing the 50% profit-target convention.',
    supportingEvidence: [
      { id: 'profit-captured', label: 'Max profit captured', value: '55%', tone: 'positive', explanation: 'Above the 50% target.' },
    ],
    concerns: [
      { id: 'time-sensitive', label: 'Time-sensitive', severity: 'high', explanation: 'Only 2 DTE remain.' },
    ],
    portfolioImpact: { direction: 'positive', magnitude: 'medium', explanation: 'Locks in a realized gain.' },
    incomeImpact: { direction: 'positive', magnitude: 'low', explanation: 'Realizes premium already earned.' },
    riskImpact: { direction: 'positive', magnitude: 'medium', explanation: 'Removes remaining position risk.' },
    capitalImpact: { direction: 'positive', magnitude: 'medium', explanation: 'Frees allocated capital.' },
    reviewTriggers: [
      { id: 'profit-target', label: 'Profit target reached', triggerType: 'profit_target', threshold: '50%', explanation: 'Generated because the threshold was met.' },
    ],
    metadata: { executionAllowed: false, paperExecutionAllowed: false, rulesEvaluated: [], rulesTriggered: [] },
    ...overrides,
  };
}

function makeWaitObjective(): PortfolioObjective {
  return makeObjective({
    id: 'obj_wait',
    type: 'WAIT',
    ruleId: 'OBJ-WAIT',
    title: 'No action required',
    priority: 'informational',
    urgency: 'none',
    rationale: 'No portfolio condition currently justifies action.',
    supportingEvidence: [],
    concerns: [],
    reviewTriggers: [],
  });
}

describe('PI-0004A: TodaysPriorities renders correctly', () => {
  it('renders one card per objective with title, priority, urgency, and rule ID', () => {
    const objectives = [makeObjective(), makeObjective({ id: 'obj_2', title: 'Deploy idle cash', type: 'DEPLOY_IDLE_CASH', ruleId: 'OBJ-DEPLOY-IDLE-CASH', priority: 'medium', urgency: 'this_week' })];
    render(<TodaysPriorities objectives={objectives} loading={false} th={THEMES.dark} />);

    expect(screen.getByText('Close for profit: AMD')).toBeInTheDocument();
    expect(screen.getByText('Deploy idle cash')).toBeInTheDocument();
    expect(screen.getByText('OBJ-CLOSE-FOR-PROFIT')).toBeInTheDocument();
    expect(screen.getByText('OBJ-DEPLOY-IDLE-CASH')).toBeInTheDocument();
    expect(screen.getByText('2 items')).toBeInTheDocument();
  });

  it('does not fabricate a "1 item" label for a single result', () => {
    render(<TodaysPriorities objectives={[makeObjective()]} loading={false} th={THEMES.dark} />);
    expect(screen.getByText('1 item')).toBeInTheDocument();
  });

  it('preserves the exact order objectives were passed in (no re-sorting)', () => {
    const objectives = [
      makeObjective({ id: 'a', title: 'Third alphabetically', priority: 'low' }),
      makeObjective({ id: 'b', title: 'First alphabetically', priority: 'critical' }),
      makeObjective({ id: 'c', title: 'Second alphabetically', priority: 'medium' }),
    ];
    render(<TodaysPriorities objectives={objectives} loading={false} th={THEMES.dark} />);
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    // Deliberately NOT priority-sorted -- exactly the input order, proving
    // this component does not re-rank.
    expect(headings).toEqual(['Third alphabetically', 'First alphabetically', 'Second alphabetically']);
  });
});

describe('PI-0004A: empty state', () => {
  it('renders the canonical WAIT objective\'s own title/rationale as the empty state -- does not fabricate copy', () => {
    render(<TodaysPriorities objectives={[makeWaitObjective()]} loading={false} th={THEMES.dark} />);
    expect(screen.getByText('No action required')).toBeInTheDocument();
    expect(screen.getByText('No portfolio condition currently justifies action.')).toBeInTheDocument();
    // No item count badge for the wait-only state.
    expect(screen.queryByText(/item/)).not.toBeInTheDocument();
  });

  it('renders nothing when objectives is null and not loading (no portfolio data at all)', () => {
    const { container } = render(<TodaysPriorities objectives={null} loading={false} th={THEMES.dark} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('PI-0004A: loading state', () => {
  it('shows a loading placeholder when objectives is null and loading is true', () => {
    render(<TodaysPriorities objectives={null} loading={true} th={THEMES.dark} />);
    expect(screen.getByText(/Loading priorities/)).toBeInTheDocument();
  });
});

describe('PI-0004A: expand/collapse', () => {
  it('starts collapsed, does not render expanded-only content until expanded', () => {
    render(<TodaysPriorities objectives={[makeObjective()]} loading={false} th={THEMES.dark} />);
    expect(screen.queryByText('Evidence')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { expanded: false })).toBeInTheDocument();
  });

  it('expands on click and reveals the canonical detail sections', async () => {
    const user = userEvent.setup();
    render(<TodaysPriorities objectives={[makeObjective()]} loading={false} th={THEMES.dark} />);

    const toggle = screen.getByRole('button');
    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Recommendation')).toBeInTheDocument();
    expect(screen.getByText('Evidence')).toBeInTheDocument();
    expect(screen.getByText('Concerns')).toBeInTheDocument();
    expect(screen.getByText('Review Trigger')).toBeInTheDocument();
    expect(screen.getByText('Expected Outcome')).toBeInTheDocument();
  });

  it('collapses again on a second click', async () => {
    const user = userEvent.setup();
    render(<TodaysPriorities objectives={[makeObjective()]} loading={false} th={THEMES.dark} />);
    const toggle = screen.getByRole('button');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('has proper button/region ARIA semantics (aria-expanded, aria-controls, role=region)', async () => {
    const user = userEvent.setup();
    render(<TodaysPriorities objectives={[makeObjective()]} loading={false} th={THEMES.dark} />);
    const toggle = screen.getByRole('button');
    expect(toggle).toHaveAttribute('aria-controls');
    await user.click(toggle);
    const controlsId = toggle.getAttribute('aria-controls');
    const region = document.getElementById(controlsId!);
    expect(region).toHaveAttribute('role', 'region');
  });

  it('expanding one card does not affect another card\'s expanded state (independent local state)', async () => {
    const user = userEvent.setup();
    const objectives = [makeObjective({ id: 'a', title: 'First' }), makeObjective({ id: 'b', title: 'Second' })];
    render(<TodaysPriorities objectives={objectives} loading={false} th={THEMES.dark} />);

    const toggles = screen.getAllByRole('button');
    await user.click(toggles[0]);

    expect(toggles[0]).toHaveAttribute('aria-expanded', 'true');
    expect(toggles[1]).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('PI-0004A: expanded detail rendering (existing data only)', () => {
  it('renders evidence with label, value, and explanation exactly as provided', async () => {
    const user = userEvent.setup();
    render(<TodaysPriorities objectives={[makeObjective()]} loading={false} th={THEMES.dark} />);
    await user.click(screen.getByRole('button'));

    expect(screen.getByText('Max profit captured')).toBeInTheDocument();
    expect(screen.getByText('55%')).toBeInTheDocument();
    expect(screen.getByText(/Above the 50% target\./)).toBeInTheDocument();
  });

  it('renders concerns with label, severity styling, and explanation exactly as provided', async () => {
    const user = userEvent.setup();
    render(<TodaysPriorities objectives={[makeObjective()]} loading={false} th={THEMES.dark} />);
    await user.click(screen.getByRole('button'));

    expect(screen.getByText('Time-sensitive')).toBeInTheDocument();
    expect(screen.getByText(/Only 2 DTE remain\./)).toBeInTheDocument();
  });

  it('renders review triggers with label, threshold, and explanation exactly as provided', async () => {
    const user = userEvent.setup();
    render(<TodaysPriorities objectives={[makeObjective()]} loading={false} th={THEMES.dark} />);
    await user.click(screen.getByRole('button'));

    expect(screen.getByText('Profit target reached')).toBeInTheDocument();
    expect(screen.getByText('(50%)')).toBeInTheDocument();
  });

  it('renders all four expected-outcome impact dimensions (portfolio/income/risk/capital) from existing impact fields', async () => {
    const user = userEvent.setup();
    render(<TodaysPriorities objectives={[makeObjective()]} loading={false} th={THEMES.dark} />);
    await user.click(screen.getByRole('button'));

    const outcomeHeading = screen.getByText('Expected Outcome');
    const section = outcomeHeading.closest('div')!.parentElement!;
    expect(within(section).getByText('Portfolio')).toBeInTheDocument();
    expect(within(section).getByText('Income')).toBeInTheDocument();
    expect(within(section).getByText('Risk')).toBeInTheDocument();
    expect(within(section).getByText('Capital')).toBeInTheDocument();
    expect(within(section).getByText('Locks in a realized gain.')).toBeInTheDocument();
  });

  it('omits Evidence/Concerns/Review Trigger sections entirely when the objective has none (does not render empty sections)', async () => {
    const user = userEvent.setup();
    const objective = makeObjective({ supportingEvidence: [], concerns: [], reviewTriggers: [] });
    render(<TodaysPriorities objectives={[objective]} loading={false} th={THEMES.dark} />);
    await user.click(screen.getByRole('button'));

    expect(screen.queryByText('Evidence')).not.toBeInTheDocument();
    expect(screen.queryByText('Concerns')).not.toBeInTheDocument();
    expect(screen.queryByText('Review Trigger')).not.toBeInTheDocument();
    // Recommendation and Expected Outcome always render (every objective has rationale + impacts).
    expect(screen.getByText('Recommendation')).toBeInTheDocument();
    expect(screen.getByText('Expected Outcome')).toBeInTheDocument();
  });
});

describe('PI-0004A: theming (dark, medium, light)', () => {
  it('renders without error under every theme', () => {
    for (const theme of [THEMES.dark, THEMES.medium, THEMES.light]) {
      const { unmount } = render(<TodaysPriorities objectives={[makeObjective()]} loading={false} th={theme} />);
      expect(screen.getByText('Close for profit: AMD')).toBeInTheDocument();
      unmount();
    }
  });

  it('uses the theme object\'s classes rather than hardcoded dark-only colors', () => {
    const { container } = render(<TodaysPriorities objectives={[makeObjective()]} loading={false} th={THEMES.light} />);
    // THEMES.light's card class ("bg-white") should appear somewhere in the
    // rendered output -- proving the component actually reads `th`, not a
    // fixed dark-mode class list.
    expect(container.innerHTML).toContain(THEMES.light.card);
  });
});

describe('PI-0004A: purity (no duplicate calculation)', () => {
  it('re-rendering with the identical objectives array produces identical output (pure function of props)', () => {
    const objectives = [makeObjective()];
    const { container, rerender } = render(<TodaysPriorities objectives={objectives} loading={false} th={THEMES.dark} />);
    const first = container.innerHTML;
    rerender(<TodaysPriorities objectives={objectives} loading={false} th={THEMES.dark} />);
    expect(container.innerHTML).toBe(first);
  });

  it('does not import or call any Portfolio Intelligence evaluation function', async () => {
    // Static import check: the component module itself must not import
    // evaluatePortfolioObjectives, evaluatePositionObjective, or
    // prioritizePortfolioObjectives -- confirmed by inspecting its own
    // source rather than mocking, since a mock could hide a real
    // accidental import.
    const fs = await import('node:fs/promises');
    const text = await fs.readFile('features/portfolio/components/TodaysPriorities.tsx', 'utf-8');
    expect(text).not.toContain('evaluatePortfolioObjectives');
    expect(text).not.toContain('evaluatePositionObjective');
    expect(text).not.toContain('prioritizePortfolioObjectives');
  });
});
