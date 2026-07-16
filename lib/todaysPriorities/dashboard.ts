// lib/todaysPriorities/dashboard.ts
//
// PI-0010A: Today's Priorities Dashboard, V1.
//
// This is an orchestration layer, not a new decision engine: every field
// consumed here was already computed by an existing producer --
// evaluatePositionObjective()/evaluatePortfolioObjectives() (via
// computeCanonicalPortfolioPriorities/scorePortfolioPositionObjective in
// app/portfolio/page.tsx), reviewsNeedingFollowUp() (PI-0008D, lib/decision-review),
// the Portfolio page's own roll-suggestion fetch, and
// lib/portfolio/positionLifecycle.ts's classifier. Nothing in this module
// scores, ranks, or evaluates anything new -- it only buckets already-scored
// objectives using fields that already exist for exactly this purpose:
//
//   - `actionability` (PI-0004B) already answers "does this belong in front
//     of the trader today", with four tiers (MONITOR / REVIEW_SOON /
//     ACTION_NEEDED / CRITICAL) -- this module maps those tiers directly
//     onto the ticket's four sections rather than inventing a new tiering.
//   - `reviewTriggers[].triggerType` already tags *why* an objective needs
//     review (earnings / dte / price / etc.) -- this module reads that tag
//     to split "Review Today" into its named subsections instead of
//     re-deriving earnings/DTE proximity itself.
//   - `DEPLOY_IDLE_CASH` is already a produced objective type -- this module
//     re-labels it as a CSP opportunity rather than computing idle cash
//     again.
//   - `objective.managementIntent.intent` (PI-0006B's canonical intent
//     selector, already computed on every position's objective) already
//     identifies which positions are Roll candidates -- this module reads
//     that field for its Roll Opportunities bucket rather than fetching or
//     scoring a roll candidate itself. (An earlier draft of this module
//     considered app/portfolio/page.tsx's live option-chain roll-suggestion
//     fetch for this purpose, but that fetch only runs when a trader
//     actively initiates a roll from the batch-action flow -- it isn't a
//     passively-available producer output the way managementIntent is, so
//     using it here would mean triggering new work, not just orchestrating
//     existing output.)
//
// Lives as its own top-level package, deliberately NOT inside
// lib/portfolio-intelligence: lib/decision-review has a documented one-way
// dependency on lib/portfolio-intelligence's types ("never the reverse" --
// see decision-review/types.ts's module doc), and this dashboard needs
// reviewsNeedingFollowUp() from decision-review alongside PortfolioObjective
// from portfolio-intelligence. Putting it inside either package would create
// exactly the circular dependency that boundary exists to prevent; sitting
// on top of both, importing from both, preserves it.
//
// Page-agnostic by design (see PI-0009A's PositionSnapshotInput for the same
// pattern): inputs are plain data the caller has already assembled, not
// live `Position`/`RollSuggestion` types from app/portfolio/page.tsx, so this
// module has no dependency on that file and stays independently testable.

import type { PortfolioObjective } from '@/lib/portfolio-intelligence';
import type { DecisionReview, DecisionReviewStore, PositionIdSet } from '@/lib/decision-review';
import { reviewsNeedingFollowUp } from '@/lib/decision-review';

// A position with no PortfolioObjective at all, or whose objective is
// MONITOR-tier, is "healthy, requires no action" -- the ticket's Monitor
// section. Only the fields the Monitor view needs are carried here.
export interface TodaysPrioritiesPositionInput {
  key: string;
  symbol: string;
  strategy: string;
  dte: number;
  healthScore: number | null;
  objective: PortfolioObjective | null;
}

// Lifecycle-classified by the caller via classifyPositionLifecycle(pos).type
// === 'ASSIGNED_STOCK' (uncovered stock from a prior assignment) -- there is
// no existing PortfolioObjective type for "sell a covered call against this
// stock" the way DEPLOY_IDLE_CASH or managementIntent's ROLL_POSITION already
// exist for the other three Opportunities buckets, so this one stays a plain,
// caller-supplied input rather than something derived from `objectives`.
export interface CoveredCallOpportunityInput {
  key: string;
  symbol: string;
  shares: number;
}

export interface TodaysPrioritiesInput {
  // The FULL per-position + portfolio-level objective list, including
  // MONITOR-tier ones -- deliberately NOT computeCanonicalPortfolioPriorities'
  // output, since that adapter intentionally excludes MONITOR (see its own
  // doc comment) and this dashboard needs MONITOR to populate its own
  // Monitor section.
  objectives: PortfolioObjective[];
  positions: TodaysPrioritiesPositionInput[];
  decisionReviews: DecisionReviewStore;
  openPositionIds: PositionIdSet;
  // Already-computed via classifyPositionLifecycle(pos).type ===
  // 'ASSIGNED_STOCK'; an empty array is a normal, honest "none right now"
  // state, not a missing-data problem.
  coveredCallOpportunities: CoveredCallOpportunityInput[];
  // Whether the trader has a live Screener scan available to read from. V1
  // does not run or duplicate the Screener's own scan pipeline (that would
  // be a new decision engine, not orchestration) -- when false, the
  // dashboard just points the trader at Screener instead of fabricating
  // candidates.
  screenerCandidatesAvailable: boolean;
}

export interface TodaysPrioritiesReviewToday {
  mediumPriority: PortfolioObjective[];
  earningsReviews: PortfolioObjective[];
  expiringPositions: PortfolioObjective[];
  needsFollowUp: DecisionReview[];
}

export interface TodaysPrioritiesMonitorEntry {
  key: string;
  symbol: string;
  strategy: string;
  dte: number;
  healthScore: number | null;
}

export interface TodaysPrioritiesOpportunities {
  rollOpportunities: PortfolioObjective[];
  coveredCallOpportunities: CoveredCallOpportunityInput[];
  cspOpportunities: PortfolioObjective[];
  screenerCandidatesAvailable: boolean;
}

export interface TodaysPrioritiesDashboard {
  immediateAction: PortfolioObjective[];
  reviewToday: TodaysPrioritiesReviewToday;
  monitor: TodaysPrioritiesMonitorEntry[];
  opportunities: TodaysPrioritiesOpportunities;
}

function hasTrigger(objective: PortfolioObjective, triggerType: string): boolean {
  return objective.reviewTriggers.some(t => t.triggerType === triggerType);
}

export function buildTodaysPrioritiesDashboard(input: TodaysPrioritiesInput): TodaysPrioritiesDashboard {
  const surfaced = input.objectives.filter(o => o.actionability !== 'MONITOR');

  const immediateAction = surfaced.filter(o => o.actionability === 'CRITICAL');

  const reviewCandidates = surfaced.filter(
    o => o.actionability === 'ACTION_NEEDED' || o.actionability === 'REVIEW_SOON',
  );
  const earningsReviews = reviewCandidates.filter(o => hasTrigger(o, 'earnings'));
  const expiringPositions = reviewCandidates.filter(o => hasTrigger(o, 'dte') && !hasTrigger(o, 'earnings'));
  const mediumPriority = reviewCandidates.filter(o => !hasTrigger(o, 'earnings') && !hasTrigger(o, 'dte'));
  const needsFollowUp = reviewsNeedingFollowUp(input.decisionReviews, input.openPositionIds);

  const monitor: TodaysPrioritiesMonitorEntry[] = input.positions
    .filter(p => p.objective == null || p.objective.actionability === 'MONITOR')
    .map(p => ({ key: p.key, symbol: p.symbol, strategy: p.strategy, dte: p.dte, healthScore: p.healthScore }));

  const cspOpportunities = input.objectives.filter(o => o.type === 'DEPLOY_IDLE_CASH');
  const rollOpportunities = input.objectives.filter(o => o.managementIntent?.intent === 'ROLL_POSITION');

  return {
    immediateAction,
    reviewToday: { mediumPriority, earningsReviews, expiringPositions, needsFollowUp },
    monitor,
    opportunities: {
      rollOpportunities,
      coveredCallOpportunities: input.coveredCallOpportunities,
      cspOpportunities,
      screenerCandidatesAvailable: input.screenerCandidatesAvailable,
    },
  };
}
