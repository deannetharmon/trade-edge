// lib/mission-control/buildMissionControlViewModel.ts
//
// MB-0002: the one function that turns /dashboard's already-loaded
// portfolio data into a ReviewNarrative-bearing view model. Pure,
// synchronous, framework-independent -- no fetch, no React, no domain
// scoring, matching lib/command-center/buildCommandCenterViewModel.ts's own
// contract exactly. It never rescores, re-ranks, or invents a value; every
// field inside the resulting `narrative` is a direct, unmodified pass-through
// from an existing canonical builder (buildAttentionFeed, conductReview) fed
// with data DashboardComposition (lib/portfolio-intelligence) already
// computed. Quinn's MB-0002 acceptance criteria are enforced by construction
// here: this file contains no ranking, no scoring, and no business logic --
// only sequencing and state classification, exactly the same division of
// responsibility TC-0001's view-model layer already established.

import { buildAttentionFeed } from '@/lib/morning-briefing';
import { conductReview } from '@/lib/review-conductor';
import type { BuildMissionControlViewModelInput, MissionControlViewModel } from './types';

export function buildMissionControlViewModel(input: BuildMissionControlViewModelInput): MissionControlViewModel {
  const now = input.now ?? new Date();
  const generatedAt = now.toISOString();
  const lastRefreshedAt = input.lastRefreshedAt ?? null;

  if (input.compositionError) {
    return { state: 'error', message: input.compositionError, narrative: null, generatedAt, lastRefreshedAt };
  }

  // buildDashboardComposition() only returns a real PortfolioReviewSnapshot
  // once at least one position or pending order has loaded this session --
  // see lib/portfolio-intelligence/dashboardComposition.ts. Before that,
  // `unavailable` (still loading) or `unavailable` (nothing loaded yet) are
  // both honest states; a Review over data that doesn't exist yet must never
  // be fabricated.
  if (!input.composition.portfolioReview) {
    return {
      state: input.compositionLoading ? 'loading' : 'unavailable',
      message: input.compositionLoading
        ? undefined
        : 'Your Review is not available yet -- open Portfolio to load current positions and balances.',
      narrative: null,
      generatedAt,
      lastRefreshedAt,
    };
  }

  const attentionFeed = buildAttentionFeed({
    dashboard: input.composition.todaysPrioritiesDashboard,
    generatedAt,
  });

  const narrative = conductReview({
    generatedAt,
    portfolioReview: input.composition.portfolioReview,
    attentionFeed,
    opportunities: input.opportunityRecommendations ?? [],
    // MB-0002 explicit non-goal: Trader Commitment persistence. No
    // commitment store is wired to this page yet, so there is nothing to
    // revalidate against -- an honest empty array, not a stand-in for
    // "nothing changed." "Since Your Last Review" will read as empty until a
    // future sprint wires up real commitments + persistence. See
    // docs/design/MB-0002-Mission-Control-Implementation.md, Known
    // Limitations.
    revalidationResults: [],
  });

  return { state: 'loaded', narrative, generatedAt, lastRefreshedAt };
}
