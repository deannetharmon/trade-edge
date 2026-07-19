// lib/command-center/types.ts
//
// TC-0001: Trade Command Center composition types.
//
// The view-model this module produces is a plain, presentation-ready
// description of five panels (Daily Briefing, Today's Priorities, Best
// Opportunity, Portfolio Health, Background Tasks). Every panel carries an
// explicit `state` so the UI never has to guess whether a `null`/empty value
// means "still loading," "genuinely empty," "failed," or "not wired up yet."
//
// `unavailable` is distinct from `empty`: `empty` means the underlying
// domain composition ran and genuinely found nothing (e.g. zero priorities);
// `unavailable` means this panel has no real data source behind it yet in
// this deployment (e.g. /dashboard does not independently fetch/enrich
// positions this sprint -- see docs/design/TC-0001-Trade-Command-Center.md,
// "Known limitations"). Both are real, honest states -- neither is ever
// backed by fabricated or sample data.

import type { PrioritizedObjective } from '@/lib/todaysPriorities';
import type { OpportunityRecommendation } from '@/lib/opportunity-engine';
import type { TradeEdgeTask } from '@/lib/tasks/task-types';
import type { DashboardComposition } from '@/lib/portfolio-intelligence/dashboardComposition';

export type CommandCenterPanelState = 'loading' | 'loaded' | 'empty' | 'error' | 'unavailable';

export interface CommandCenterHeaderViewModel {
  greeting: string;
  generatedAt: string;
  lastRefreshedAt: string | null;
  state: CommandCenterPanelState;
  message?: string;
}

export interface CommandCenterBriefingViewModel {
  state: CommandCenterPanelState;
  executiveSummary?: string;
  message?: string;
}

export interface CommandCenterPrioritiesViewModel {
  state: CommandCenterPanelState;
  items: PrioritizedObjective[];
  message?: string;
}

export interface CommandCenterHealthViewModel {
  state: CommandCenterPanelState;
  score?: number;
  status?: string;
  message?: string;
}

export interface CommandCenterOpportunityViewModel {
  state: CommandCenterPanelState;
  recommendations: OpportunityRecommendation[];
  generatedAt?: string;
  message?: string;
}

export interface CommandCenterTasksViewModel {
  state: CommandCenterPanelState;
  tasks: TradeEdgeTask[];
  message?: string;
}

export interface CommandCenterViewModel {
  header: CommandCenterHeaderViewModel;
  briefing: CommandCenterBriefingViewModel;
  priorities: CommandCenterPrioritiesViewModel;
  bestOpportunity: CommandCenterOpportunityViewModel;
  health: CommandCenterHealthViewModel;
  backgroundTasks: CommandCenterTasksViewModel;
}

// ---------------------------------------------------------------------------
// Input -- everything this view-model composition needs. `composition` is
// `null` when no real Portfolio Intelligence data source is available to
// this page yet (this sprint's known, disclosed limitation -- see the
// design doc); a future ticket that wires up a real, independently-fetched
// composition (via the exact same buildDashboardComposition() contract
// app/portfolio/page.tsx already uses) only needs to stop passing `null`
// here -- no change to this function's own logic.
// ---------------------------------------------------------------------------

export interface BuildCommandCenterViewModelInput {
  composition: DashboardComposition | null;
  compositionError?: string;
  opportunityRecommendations: OpportunityRecommendation[] | null;
  opportunityError?: string;
  tasks: TradeEdgeTask[];
  now?: Date;
  lastRefreshedAt?: string | null;
}
