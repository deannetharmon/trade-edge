// lib/command-center/__tests__/buildCommandCenterViewModel.test.ts
//
// TC-0001: coverage for the Command Center's one deterministic view-model
// composition function. Verifies the loaded/empty/error/unavailable state
// contract for every panel, the exact required empty-state copy from
// docs/design/TC-0001-Trade-Command-Center.md, and that the function never
// invents data, rescores anything, or converts an error into a success.

import { describe, expect, it } from 'vitest';
import { buildCommandCenterViewModel } from '../buildCommandCenterViewModel';
import type { DashboardComposition } from '@/lib/portfolio-intelligence/dashboardComposition';
import type { OpportunityRecommendation } from '@/lib/opportunity-engine';
import type { TradeEdgeTask } from '@/lib/tasks/task-types';

const FIXED_NOW = new Date('2026-07-19T09:00:00.000Z'); // 09:00 UTC -- exercise "morning" branch deterministically

function baseComposition(overrides: Partial<DashboardComposition> = {}): DashboardComposition {
  return {
    canonicalPriorities: null,
    todaysPrioritiesDashboard: { immediateAction: [], monitor: [], onTrack: [] } as any,
    topPriority: null,
    averagePositionHealth: null,
    portfolioHealth: { score: 82, status: 'Healthy' } as any,
    portfolioReview: null,
    dailyBriefing: {
      executiveSummary: 'Portfolio is stable; no action required today.',
      priorities: [],
    } as any,
    ...overrides,
  };
}

describe('TC-0001: buildCommandCenterViewModel', () => {
  it('renders unavailable state (with required message) for header/briefing/priorities/health when composition is null', () => {
    const vm = buildCommandCenterViewModel({
      composition: null,
      opportunityRecommendations: [],
      tasks: [],
      now: FIXED_NOW,
    });

    expect(vm.header.state).toBe('unavailable');
    expect(vm.briefing.state).toBe('unavailable');
    expect(vm.priorities.state).toBe('unavailable');
    expect(vm.health.state).toBe('unavailable');
    expect(vm.priorities.items).toEqual([]);
  });

  it('renders error state (never masked as success) when compositionError is set, even if composition is also provided', () => {
    const vm = buildCommandCenterViewModel({
      composition: baseComposition(),
      compositionError: 'Failed to load positions.',
      opportunityRecommendations: [],
      tasks: [],
      now: FIXED_NOW,
    });

    expect(vm.header.state).toBe('error');
    expect(vm.briefing.state).toBe('error');
    expect(vm.priorities.state).toBe('error');
    expect(vm.health.state).toBe('error');
    expect(vm.header.message).toBe('Failed to load positions.');
  });

  it('renders loaded state with the real executiveSummary and score when composition is present and populated', () => {
    const vm = buildCommandCenterViewModel({
      composition: baseComposition(),
      opportunityRecommendations: [],
      tasks: [],
      now: FIXED_NOW,
    });

    expect(vm.briefing.state).toBe('loaded');
    expect(vm.briefing.executiveSummary).toBe('Portfolio is stable; no action required today.');
    expect(vm.health.state).toBe('loaded');
    expect(vm.health.score).toBe(82);
    expect(vm.health.status).toBe('Healthy');
  });

  it('renders empty state with the exact required copy when dailyBriefing exists but has zero priorities', () => {
    const vm = buildCommandCenterViewModel({
      composition: baseComposition({ dailyBriefing: { executiveSummary: 'All clear.', priorities: [] } as any }),
      opportunityRecommendations: [],
      tasks: [],
      now: FIXED_NOW,
    });

    expect(vm.priorities.state).toBe('empty');
    expect(vm.priorities.message).toBe('No portfolio actions currently require attention.');
  });

  it('renders empty state with the exact required copy when dailyBriefing itself is null', () => {
    const vm = buildCommandCenterViewModel({
      composition: baseComposition({ dailyBriefing: null }),
      opportunityRecommendations: [],
      tasks: [],
      now: FIXED_NOW,
    });

    expect(vm.briefing.state).toBe('empty');
    expect(vm.briefing.message).toBe('Daily Briefing is unavailable.');
  });

  it('renders the exact required empty-state copy for Best Opportunity when no recommendations exist', () => {
    const vm = buildCommandCenterViewModel({
      composition: null,
      opportunityRecommendations: [],
      tasks: [],
      now: FIXED_NOW,
    });

    expect(vm.bestOpportunity.state).toBe('empty');
    expect(vm.bestOpportunity.message).toBe('No ranked opportunity feed is available.');
    expect(vm.bestOpportunity.recommendations).toEqual([]);
  });

  it('renders the same empty Best Opportunity state when opportunityRecommendations is null (never defaults to a fabricated list)', () => {
    const vm = buildCommandCenterViewModel({
      composition: null,
      opportunityRecommendations: null,
      tasks: [],
      now: FIXED_NOW,
    });

    expect(vm.bestOpportunity.state).toBe('empty');
    expect(vm.bestOpportunity.recommendations).toEqual([]);
  });

  it('passes real recommendations through unchanged -- never rescoring or reordering them', () => {
    const recs = [
      { candidateId: 'a', symbol: 'AAPL', rank: 1 } as unknown as OpportunityRecommendation,
      { candidateId: 'b', symbol: 'SPY', rank: 2 } as unknown as OpportunityRecommendation,
    ];
    const vm = buildCommandCenterViewModel({
      composition: null,
      opportunityRecommendations: recs,
      tasks: [],
      now: FIXED_NOW,
    });

    expect(vm.bestOpportunity.state).toBe('loaded');
    expect(vm.bestOpportunity.recommendations).toBe(recs); // same reference: no copy/reorder/rescoring
  });

  it('renders error state for Best Opportunity when opportunityError is set, regardless of recommendations', () => {
    const vm = buildCommandCenterViewModel({
      composition: null,
      opportunityRecommendations: [{ candidateId: 'a' } as unknown as OpportunityRecommendation],
      opportunityError: 'Ranking failed.',
      tasks: [],
      now: FIXED_NOW,
    });

    expect(vm.bestOpportunity.state).toBe('error');
    expect(vm.bestOpportunity.message).toBe('Ranking failed.');
  });

  it('renders the exact required empty-state copy for Background Tasks when there are none', () => {
    const vm = buildCommandCenterViewModel({
      composition: null,
      opportunityRecommendations: [],
      tasks: [],
      now: FIXED_NOW,
    });

    expect(vm.backgroundTasks.state).toBe('empty');
    expect(vm.backgroundTasks.message).toBe('No background tasks are running.');
  });

  it('renders loaded Background Tasks with the real task list, unchanged', () => {
    const tasks: TradeEdgeTask[] = [
      { id: 't1', kind: 'screener-scan', title: 'Screener scan', status: 'running', createdAt: '2026-07-19T08:00:00.000Z' },
    ];
    const vm = buildCommandCenterViewModel({
      composition: null,
      opportunityRecommendations: [],
      tasks,
      now: FIXED_NOW,
    });

    expect(vm.backgroundTasks.state).toBe('loaded');
    expect(vm.backgroundTasks.tasks).toBe(tasks);
  });

  it('greets by local hour: morning/afternoon/evening boundaries', () => {
    const morning = buildCommandCenterViewModel({
      composition: null,
      opportunityRecommendations: [],
      tasks: [],
      now: new Date(2026, 6, 19, 8, 0, 0),
    });
    const afternoon = buildCommandCenterViewModel({
      composition: null,
      opportunityRecommendations: [],
      tasks: [],
      now: new Date(2026, 6, 19, 14, 0, 0),
    });
    const evening = buildCommandCenterViewModel({
      composition: null,
      opportunityRecommendations: [],
      tasks: [],
      now: new Date(2026, 6, 19, 20, 0, 0),
    });

    expect(morning.header.greeting).toBe('Good morning');
    expect(afternoon.header.greeting).toBe('Good afternoon');
    expect(evening.header.greeting).toBe('Good evening');
  });

  it('passes lastRefreshedAt through as an explicit, undefaulted value', () => {
    const vm = buildCommandCenterViewModel({
      composition: null,
      opportunityRecommendations: [],
      tasks: [],
      now: FIXED_NOW,
      lastRefreshedAt: '2026-07-19T08:55:00.000Z',
    });

    expect(vm.header.lastRefreshedAt).toBe('2026-07-19T08:55:00.000Z');
  });

  it('defaults lastRefreshedAt to null (never fabricates a refresh time) when not supplied', () => {
    const vm = buildCommandCenterViewModel({
      composition: null,
      opportunityRecommendations: [],
      tasks: [],
      now: FIXED_NOW,
    });

    expect(vm.header.lastRefreshedAt).toBeNull();
  });
});
