// lib/mission-control/types.ts
//
// MB-0002: the page-specific wiring contract between /dashboard's already-
// loaded portfolio data and lib/review-conductor's ReviewNarrative. This is
// NOT a new domain layer -- it is the same kind of thin, page-specific
// view-model wiring lib/command-center/buildCommandCenterViewModel.ts
// already established for TC-0001 (an explicit `state` on the result so the
// UI never has to guess whether missing data means "still loading,"
// "genuinely empty," "failed," or "not available on this page yet").
//
// This module composes; it does not decide. Every ranked, scored, or
// prioritized value inside the resulting ReviewNarrative was already
// produced by lib/review-conductor, lib/morning-briefing, lib/portfolioReview,
// or lib/opportunity-engine -- unchanged, per MB-0001B's approved
// architectural standards (carried forward as binding project standards into
// this sprint).

import type { DashboardComposition } from '@/lib/portfolio-intelligence/dashboardComposition';
import type { OpportunityRecommendation } from '@/lib/opportunity-engine';
import type { ReviewNarrative } from '@/lib/review-conductor';
import type { TodaysPrioritiesQueueItem } from '@/lib/todays-priorities-queue';
import type { PriorityWorkflowState } from '@/features/portfolio/priorities/priorityWorkflowState';

// WA-0003: Mission Control's reduced Attention Required summary (CES section
// 11) -- lead item, open count, and deep link, all derived from the SAME
// shared queue+partition logic Today's Priorities uses
// (lib/todays-priorities-queue), never from narrative.attention/
// narrative.counts.attention (which stays unchanged for its own existing
// purpose -- see the CES's section 11 disclosed rationale on why reusing it
// here would risk a silent count/lead-item drift). `deepLink` is always an
// absolute, level-1 application path (/portfolio?tab=todays-priorities&
// priority=<stableKey>), since this summary renders on /dashboard and a
// query-only URL would resolve against /dashboard, not /portfolio -- Mission
// Control never links directly to Positions or Decision History.
export interface MissionControlTodaysPrioritiesSummary {
  leadItem: TodaysPrioritiesQueueItem | null;
  openCount: number;
  deepLink: string | null;
}

export type MissionControlState = 'loading' | 'loaded' | 'empty' | 'error' | 'unavailable';

// `empty` vs `unavailable` mirrors lib/command-center/types.ts's existing
// distinction exactly: `unavailable` means no real Portfolio Review data
// source exists for this render yet (still loading, or nothing loaded this
// session); `empty` is reserved for a future case where a real, computed
// PortfolioReviewSnapshot itself is genuinely empty -- buildPortfolioReview()
// always returns a real snapshot once positions/pendingOrders exist, so
// `empty` is not reachable via today's inputs, but the state exists so a
// consumer never has to special-case its absence.
export interface MissionControlViewModel {
  state: MissionControlState;
  message?: string;
  narrative: ReviewNarrative | null;
  generatedAt: string;
  lastRefreshedAt: string | null;
  // WA-0003: additive (CES section 11/15) -- always populated (never null),
  // even when `narrative` itself is null, so the UI never has to
  // special-case its absence. { leadItem: null, openCount: 0, deepLink: null }
  // in every non-'loaded' state.
  todaysPriorities: MissionControlTodaysPrioritiesSummary;
}

export interface BuildMissionControlViewModelInput {
  // Always a real DashboardComposition object (PortfolioDataProvider never
  // hands back null), but its own `portfolioReview` field is `null` when no
  // positions/pending orders have loaded yet this session -- an honest
  // "nothing to review yet" state, never fabricated.
  composition: DashboardComposition;
  compositionLoading: boolean;
  compositionError?: string;
  opportunityRecommendations: OpportunityRecommendation[] | null;
  opportunityError?: string;
  now?: Date;
  lastRefreshedAt?: string | null;
  // WA-0003: additive (CES section 11) -- the trader's stored Priority
  // Workflow state (features/portfolio/priorities/priorityWorkflowState.ts,
  // UNCHANGED), read from localStorage by app/dashboard/page.tsx itself
  // (mirroring TodaysPrioritiesWorkflow.tsx's existing pattern) and threaded
  // in as plain data -- this module stays pure, no localStorage access here.
  // Defaults to {} when omitted (e.g. server-side / not-yet-loaded), which
  // is the same honest "nothing completed yet" state loadPriorityWorkflowState()
  // itself returns before its first client read.
  workflowState?: PriorityWorkflowState;
}
