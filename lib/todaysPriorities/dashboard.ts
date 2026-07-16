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
//
// PI-0010B: Intelligent Prioritization -- every actionable objective bucket
// (Immediate Action; Review Today's three objective subsections; the CSP and
// Roll Opportunities buckets) is now additionally run through
// lib/priorityScore's calculatePriorityScore() and sorted highest-score
// first, so "what's on this list" (PI-0010A's job, unchanged above) and
// "what order should I work through it in" (this ticket's job) stay cleanly
// separated. Monitor and the lifecycle-classified Covered Call/Screener
// buckets are deliberately NOT scored -- Monitor is explicitly "requires no
// action", and Covered Call/Screener opportunities aren't backed by a
// PortfolioObjective (no confidence/managementIntent/reviewTriggers to score
// against) the way CSP/Roll opportunities are.

import type { PortfolioObjective } from '@/lib/portfolio-intelligence';
import type { DecisionReview, DecisionReviewStore, PositionIdSet } from '@/lib/decision-review';
import { reviewsNeedingFollowUp } from '@/lib/decision-review';
import { calculatePriorityScore, DEFAULT_PRIORITY_SCORE_CONFIG } from '@/lib/priorityScore';
import type { PriorityScoreConfig, PriorityScorePositionContext, PriorityTier } from '@/lib/priorityScore';

// A position with no PortfolioObjective at all, or whose objective is
// MONITOR-tier, is "healthy, requires no action" -- the ticket's Monitor
// section. Only the fields the Monitor view needs are carried here.
//
// PI-0010B: the five fields after `objective` are the per-position context
// Priority Score needs that the objective itself doesn't carry (see
// lib/priorityScore/priorityScore.ts's PriorityScorePositionContext) --
// every one of them is a value app/portfolio/page.tsx already computes
// elsewhere for other purposes (net edge evidence, remaining opportunity,
// max risk, decision review lookup); nothing new is fetched or scored to
// populate them.
export interface TodaysPrioritiesPositionInput {
  key: string;
  symbol: string;
  strategy: string;
  dte: number;
  healthScore: number | null;
  objective: PortfolioObjective | null;
  netEdgeDeclinePct: number | null;
  netEdgeNegative: boolean;
  remainingOpportunityPct: number | null;
  capitalAtRisk: number | null;
  hasPendingDecisionReview: boolean;
}

// An objective paired with its Priority Score -- the presentation layer
// reads `objective` for everything it already rendered (title, type badge,
// rationale, evidence, impacts, etc.) and `score`/`tier`/`reasons` for the
// new priority card fields this ticket adds.
export interface PrioritizedObjective {
  objective: PortfolioObjective;
  score: number;
  tier: PriorityTier;
  reasons: string[];
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
  // PI-0010B: overrides the default Priority Score weighting (see
  // lib/priorityScore/config.ts's own doc comment on why this lives in one
  // centralized place). Omitted in every real caller today -- present so a
  // future settings screen can pass a trader-tuned config through this same
  // orchestration layer without this module's bucketing logic changing.
  priorityScoreConfig?: PriorityScoreConfig;
}

export interface TodaysPrioritiesReviewToday {
  mediumPriority: PrioritizedObjective[];
  earningsReviews: PrioritizedObjective[];
  expiringPositions: PrioritizedObjective[];
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
  rollOpportunities: PrioritizedObjective[];
  coveredCallOpportunities: CoveredCallOpportunityInput[];
  cspOpportunities: PrioritizedObjective[];
  screenerCandidatesAvailable: boolean;
}

export interface TodaysPrioritiesDashboard {
  immediateAction: PrioritizedObjective[];
  reviewToday: TodaysPrioritiesReviewToday;
  monitor: TodaysPrioritiesMonitorEntry[];
  opportunities: TodaysPrioritiesOpportunities;
}

function hasTrigger(objective: PortfolioObjective, triggerType: string): boolean {
  return objective.reviewTriggers.some(t => t.triggerType === triggerType);
}

// PI-0010B: matches an objective back to the position that produced it (via
// `subject.id`, which every position-sourced objective sets to the same
// position key app/portfolio/page.tsx already uses everywhere else -- see
// evaluatePositionObjective()'s `subject: { id: legacy.positionId, ... }`).
// Portfolio-level objectives (DEPLOY_IDLE_CASH, concentration, buying power,
// etc.) have no single backing position and correctly get `null` here --
// calculatePriorityScore() falls back to each factor's configured neutral
// default in that case rather than fabricating position context.
function positionContextFor(
  objective: PortfolioObjective,
  positionsByKey: ReadonlyMap<string, TodaysPrioritiesPositionInput>,
): PriorityScorePositionContext | null {
  if (objective.subject.type !== 'position' || !objective.subject.id) return null;
  const position = positionsByKey.get(objective.subject.id);
  if (!position) return null;
  return {
    dte: position.dte,
    healthScore: position.healthScore,
    netEdgeDeclinePct: position.netEdgeDeclinePct,
    netEdgeNegative: position.netEdgeNegative,
    remainingOpportunityPct: position.remainingOpportunityPct,
    capitalAtRisk: position.capitalAtRisk,
    hasPendingDecisionReview: position.hasPendingDecisionReview,
  };
}

// Scores every objective in `objectives` and returns them sorted highest
// Priority Score first (ties broken by the objectives' own existing order,
// since Array.prototype.sort is a stable sort).
function prioritize(
  objectives: PortfolioObjective[],
  positionsByKey: ReadonlyMap<string, TodaysPrioritiesPositionInput>,
  config: PriorityScoreConfig,
): PrioritizedObjective[] {
  return objectives
    .map((objective) => {
      const { score, tier, reasons } = calculatePriorityScore(
        { objective, position: positionContextFor(objective, positionsByKey) },
        config,
      );
      return { objective, score, tier, reasons };
    })
    .sort((a, b) => b.score - a.score);
}

export function buildTodaysPrioritiesDashboard(input: TodaysPrioritiesInput): TodaysPrioritiesDashboard {
  const config = input.priorityScoreConfig ?? DEFAULT_PRIORITY_SCORE_CONFIG;
  const positionsByKey = new Map(input.positions.map((p) => [p.key, p] as const));
  const rank = (objectives: PortfolioObjective[]) => prioritize(objectives, positionsByKey, config);

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
    immediateAction: rank(immediateAction),
    reviewToday: {
      mediumPriority: rank(mediumPriority),
      earningsReviews: rank(earningsReviews),
      expiringPositions: rank(expiringPositions),
      needsFollowUp,
    },
    monitor,
    opportunities: {
      rollOpportunities: rank(rollOpportunities),
      coveredCallOpportunities: input.coveredCallOpportunities,
      cspOpportunities: rank(cspOpportunities),
      screenerCandidatesAvailable: input.screenerCandidatesAvailable,
    },
  };
}
