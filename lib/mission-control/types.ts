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
}
