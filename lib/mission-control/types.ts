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
// WA-0004 (CES section 11, corrective ruling): Mission Control's reduced
// "Since Your Last Review" summary -- lead text, count, one-line compact
// summary, and a single deep link into Briefing, all derived from the SAME
// `narrative.sinceLastReview.changes` + shared `TRADER_COMMITMENT_TRACKING_ACTIVE`
// flag (lib/review-conductor) Briefing's own full section uses, computed
// once here rather than re-derived independently by the presentation
// component (mirrors `MissionControlTodaysPrioritiesSummary`'s existing
// pattern exactly). `deepLink` is always the absolute application path
// `/portfolio?tab=briefing` -- never a query-only `?tab=briefing` string
// (this summary renders on /dashboard) and never `/dashboard?tab=briefing`.
export interface MissionControlSinceLastReviewSummary {
  trackingActive: boolean;
  // First change's commitment.subject.label when changes exist; the
  // honest tracking-unavailable copy when `trackingActive` is false; the
  // genuine-zero-change copy when `trackingActive` is true and there are no
  // changes. Never blank.
  leadText: string;
  // `null` exactly when `trackingActive` is false -- a `0` here would
  // itself imply "tracking ran and found nothing," which is not true today.
  count: number | null;
  summary: string;
  deepLink: string;
}

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
  // WA-0004 (CES section 11) -- always populated (never null), even when
  // `narrative` itself is null, mirroring `todaysPriorities`'s convention.
  sinceLastReview: MissionControlSinceLastReviewSummary;
  // WA-0005 (CES section 7/11): the Recommendation Service's own, genuinely
  // nullable generatedAt (lib/recommendations/RecommendationService.ts) --
  // distinct from this view model's synthetic top-level `generatedAt`
  // (always a real timestamp, this render's own clock read). `null` means
  // nothing has been published to the Recommendation Service this session
  // (never ran, a hard reload reset it to EMPTY_STATE, or an upstream
  // evaluation failure never reached publishRecommendations) -- Mission
  // Control's compact summary needs this exact distinction to render "no
  // current ranked results" truthfully rather than conflating it with a
  // genuinely-empty published result (CES section 7's required states).
  opportunitiesGeneratedAt: string | null;
  // PO corrective round 4 (WA-0005 Defect 1): the Recommendation Service's
  // own real evaluation-lifecycle status (lib/recommendations/
  // RecommendationService.ts's `status` field) -- distinct from
  // `opportunitiesGeneratedAt` above, which describes the last
  // SUCCESSFULLY published set. This describes the MOST RECENT evaluation
  // ATTEMPT: 'loading' means a newer evaluation is running right now (the
  // last published set, if any, is still what `opportunitiesGeneratedAt`
  // and the caller's `opportunityRecommendations` describe -- never
  // cleared just because a newer attempt started); 'error' means the most
  // recent attempt failed (again, without clearing the prior valid
  // publish). Defaults to 'idle' when omitted, matching
  // RecommendationService's own default and preserving every existing
  // caller/test that does not pass this field.
  // Optional (defaults to 'idle' at the presentation layer) so every
  // existing caller/test that builds a MissionControlViewModel literal
  // without this field (predating this correction) continues to compile
  // and behave exactly as before.
  opportunitiesEvaluationStatus?: 'idle' | 'loading' | 'error';
  // The most recent evaluation attempt's failure message, or `null`/
  // `undefined` when `opportunitiesEvaluationStatus !== 'error'`.
  opportunitiesEvaluationError?: string | null;
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
  // PO corrective round 4 (WA-0005 Defect 1): previously declared but never
  // wired to any real signal or consumed by buildMissionControlViewModel.ts
  // -- now properly threaded through as the Recommendation Service's own
  // real evaluation-failure message (RecommendationSet.error), sourced from
  // app/dashboard/page.tsx's useCurrentRecommendations() read. `undefined`
  // when the most recent attempt did not fail (nothing to report).
  opportunityError?: string;
  // WA-0005: the Recommendation Service's own nullable generatedAt --
  // threaded through separately from this input's `now`/the resulting
  // view model's synthetic `generatedAt`, so Mission Control's compact
  // summary can truthfully distinguish "nothing published this session"
  // from "a scan published and produced zero ranked candidates." Defaults
  // to `null` when omitted (the honest "nothing published" default).
  opportunityRecommendationsGeneratedAt?: string | null;
  // PO corrective round 4 (WA-0005 Defect 1): the Recommendation Service's
  // own real evaluation-lifecycle status (RecommendationSet.status) --
  // sourced the same way as opportunityRecommendationsGeneratedAt/
  // opportunityError above, from the same useCurrentRecommendations() read.
  // Defaults to 'idle' when omitted.
  opportunityRecommendationsStatus?: 'idle' | 'loading' | 'error';
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
