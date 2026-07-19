// lib/command-center/buildCommandCenterViewModel.ts
//
// TC-0001: the one deterministic composition function the design spec
// requires (docs/design/TC-0001-Trade-Command-Center.md, section 5.3). Pure,
// synchronous, framework-independent -- no fetch, no React, no domain
// scoring. It accepts already-computed domain outputs (a
// DashboardComposition from lib/portfolio-intelligence/dashboardComposition,
// already-ranked OpportunityRecommendation[], and the live TaskManager's own
// task list) and selects/formats/orders them into a presentation-ready
// CommandCenterViewModel. It never rescores a recommendation, changes a
// disposition, invents missing data, converts an error into a success, or
// defaults an ambiguous portfolio context -- per the design spec's explicit
// view-model constraints.

import type {
  BuildCommandCenterViewModelInput,
  CommandCenterViewModel,
  CommandCenterPanelState,
} from './types';

function greetingFor(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function buildCommandCenterViewModel(input: BuildCommandCenterViewModelInput): CommandCenterViewModel {
  const now = input.now ?? new Date();
  const { composition, compositionError, opportunityRecommendations, opportunityError, tasks, lastRefreshedAt } = input;

  // --- header -----------------------------------------------------------
  const headerState: CommandCenterPanelState = compositionError
    ? 'error'
    : composition
      ? 'loaded'
      : 'unavailable';
  const header = {
    greeting: greetingFor(now),
    generatedAt: now.toISOString(),
    lastRefreshedAt: lastRefreshedAt ?? null,
    state: headerState,
    ...(compositionError
      ? { message: compositionError }
      : !composition
        ? { message: 'Portfolio context is not available on this page yet -- open Portfolio to load current positions and balances.' }
        : {}),
  };

  // --- briefing -----------------------------------------------------------
  const briefing = compositionError
    ? { state: 'error' as const, message: compositionError }
    : !composition
      ? { state: 'unavailable' as const, message: 'Daily Briefing is unavailable -- open Portfolio to generate today’s briefing.' }
      : !composition.dailyBriefing
        ? { state: 'empty' as const, message: 'Daily Briefing is unavailable.' }
        : { state: 'loaded' as const, executiveSummary: composition.dailyBriefing.executiveSummary };

  // --- priorities -----------------------------------------------------------
  const priorities = compositionError
    ? { state: 'error' as const, items: [], message: compositionError }
    : !composition
      ? { state: 'unavailable' as const, items: [], message: 'Today’s Priorities is unavailable -- open Portfolio to load current priorities.' }
      : composition.dailyBriefing && composition.dailyBriefing.priorities.length > 0
        ? { state: 'loaded' as const, items: composition.dailyBriefing.priorities }
        : { state: 'empty' as const, items: [], message: 'No portfolio actions currently require attention.' };

  // --- health -----------------------------------------------------------
  const health = compositionError
    ? { state: 'error' as const, message: compositionError }
    : !composition
      ? { state: 'unavailable' as const, message: 'Portfolio Health is unavailable -- open Portfolio to compute your current health score.' }
      : { state: 'loaded' as const, score: composition.portfolioHealth.score, status: composition.portfolioHealth.status };

  // --- bestOpportunity -----------------------------------------------------------
  const bestOpportunity = opportunityError
    ? { state: 'error' as const, recommendations: [], message: opportunityError }
    : !opportunityRecommendations || opportunityRecommendations.length === 0
      ? { state: 'empty' as const, recommendations: [], message: 'No ranked opportunity feed is available.' }
      : { state: 'loaded' as const, recommendations: opportunityRecommendations, generatedAt: now.toISOString() };

  // --- backgroundTasks -----------------------------------------------------------
  const backgroundTasks = tasks.length > 0
    ? { state: 'loaded' as const, tasks }
    : { state: 'empty' as const, tasks: [], message: 'No background tasks are running.' };

  return { header, briefing, priorities, bestOpportunity, health, backgroundTasks };
}
