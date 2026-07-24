// lib/morning-briefing/attentionFeed.ts
//
// MB-0001A: Morning Briefing Attention Feed -- a pure, read-only composition
// layer over the already-computed Today's Priorities output. Per
// docs/design/MB-0001A-Attention-Feed.md section 1, this module introduces
// no second attention engine, scoring model, severity system, or
// independent rule set. Every score, tier, actionability classification,
// and explanation used here was already produced upstream by:
//
//   - PortfolioObjective.actionability      (CRITICAL/ACTION_NEEDED/etc.)
//   - calculatePriorityScore()              (via buildTodaysPrioritiesDashboard)
//   - buildTodaysPrioritiesDashboard()      (the input this module consumes)
//   - buildRecommendationExplanation()      (reused verbatim, see below)
//   - selectTopPriority()                   (left untouched; see the parity
//                                             test in __tests__ for why
//                                             topAttentionItem's own,
//                                             CES-specified tie-break order
//                                             does not need to reproduce it
//                                             move-for-move -- only agree on
//                                             which objective is on top).
//
// This module only flattens, labels-by-origin, and globally orders what
// those producers already computed.

import {
  buildRecommendationExplanation,
  type PrioritizedObjective,
  type RecommendationDriver,
  type TodaysPrioritiesMonitorEntry,
} from '@/lib/todaysPriorities';
import type {
  AttentionExplanation,
  AttentionFeed,
  AttentionItem,
  AttentionSource,
  BuildAttentionFeedInput,
} from './types';

// CES section 6 / handoff "Deterministic global order": lower index sorts
// first when scores tie. MONITOR is included only so the map stays total
// over every AttentionSource; MONITOR-banded items never enter
// orderedActionable (they are not actionable -- see buildHealthyItem below),
// so this value is never actually consulted by the comparator.
const SOURCE_PRECEDENCE: Record<AttentionSource, number> = {
  IMMEDIATE_ACTION: 0,
  EARNINGS_REVIEW: 1,
  EXPIRING_POSITION: 2,
  MEDIUM_PRIORITY: 3,
  ROLL_OPPORTUNITY: 4,
  CSP_OPPORTUNITY: 5,
  MONITOR: 6,
};

// CES section 7 / "Monitor" mapping rule: Monitor is explicitly "requires no
// action" (see lib/todaysPriorities/dashboard.ts's own module doc). This is
// a fixed, honest restatement of that already-established, already-documented
// semantic -- not a new market judgment, market fact, or recommendation
// vocabulary invented for this sprint.
const HEALTHY_RECOMMENDED_ACTION = 'No action required today.';

// Reuses, not reinterprets, buildRecommendationExplanation()'s output --
// see docs/design/MB-0001A-Attention-Feed.md section 7. `decisionDrivers` is
// a string[] on the public contract (the CES's AttentionExplanation shape),
// so each existing RecommendationDriver is flattened to one line combining
// its existing label and value exactly as already rendered by
// features/portfolio/dashboard/TodaysPrioritiesDashboard.tsx's driver list --
// no new driver text is authored here.
function driverToLine(driver: RecommendationDriver): string {
  if (driver.value !== undefined && driver.value !== '') {
    return `${driver.label}: ${driver.value}`;
  }
  return driver.label;
}

function toExplanation(item: PrioritizedObjective): AttentionExplanation {
  const explanation = buildRecommendationExplanation(item);
  return {
    confidenceLabel: explanation.confidence.label,
    confidenceScore: explanation.confidence.score,
    decisionDrivers: explanation.drivers.map(driverToLine),
    whyNow: explanation.whyNow,
  };
}

// IMMEDIATE and WATCH items are both objective-backed PrioritizedObjective
// entries -- only `band` and `source` differ between the two CES sections
// that call this.
//
// Field-mapping decisions (per the handoff's "inspect the existing UI and
// exported objective type" instruction, using only fields Today's
// Priorities already displays -- see
// features/portfolio/components/TodaysPriorities.tsx's own documented
// field-mapping comment, PI-0004A, which is the precedent this follows):
//   headline         -> objective.title      (that file's "Priority title")
//   recommendedAction -> objective.rationale (that file's own "[expanded]
//                        Recommendation -> objective.rationale" mapping --
//                        reused verbatim here, not reinterpreted)
//   reasons          -> item.reasons (the raw Priority Score reasons, kept
//                        separate from `explanation.decisionDrivers`, which
//                        is buildRecommendationExplanation()'s own distinct,
//                        deduplicated/capped driver list)
//   strategy         -> null. PortfolioObjective carries no trading-strategy
//                        field (BPS/CSP/etc.) -- only
//                        TodaysPrioritiesPositionInput/
//                        TodaysPrioritiesMonitorEntry do, and neither is
//                        available at this layer for objective-backed
//                        buckets. Honest null, not a fabricated guess.
function toActionableItem(
  entry: PrioritizedObjective,
  band: 'IMMEDIATE' | 'WATCH',
  source: AttentionSource,
): AttentionItem {
  const { objective } = entry;
  return {
    id: objective.id,
    subjectId: objective.subject.id ?? null,
    symbol: objective.subject.symbol ?? null,
    strategy: null,
    band,
    source,
    score: entry.score,
    tier: entry.tier,
    headline: objective.title,
    recommendedAction: objective.rationale,
    reasons: entry.reasons,
    explanation: toExplanation(entry),
    objective,
  };
}

// CES section 5 / "HEALTHY": monitor entries have no PortfolioObjective, no
// PriorityScore, and no recommendation explanation -- score/tier/explanation/
// objective are honestly null/empty here, never fabricated.
function toHealthyItem(entry: TodaysPrioritiesMonitorEntry): AttentionItem {
  return {
    id: entry.key,
    subjectId: entry.key,
    symbol: entry.symbol,
    strategy: entry.strategy,
    band: 'HEALTHY',
    source: 'MONITOR',
    score: null,
    tier: null,
    headline: `${entry.symbol} ${entry.strategy}`.trim(),
    recommendedAction: HEALTHY_RECOMMENDED_ACTION,
    reasons: [],
    explanation: null,
    objective: null,
  };
}

// CES section 6: higher score first; on an equal score, source precedence;
// on an equal score and source, lexical id ascending. Never relies on
// incidental array/insertion order.
function compareActionable(a: AttentionItem, b: AttentionItem): number {
  const scoreA = a.score ?? Number.NEGATIVE_INFINITY;
  const scoreB = b.score ?? Number.NEGATIVE_INFINITY;
  if (scoreA !== scoreB) return scoreB - scoreA;

  const precedenceDiff = SOURCE_PRECEDENCE[a.source] - SOURCE_PRECEDENCE[b.source];
  if (precedenceDiff !== 0) return precedenceDiff;

  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

// CES section 5 "Excluded in MB-0001A": these three sources are
// deliberately NOT read or converted by this function --
//   dashboard.reviewToday.needsFollowUp        (a decision-review workflow
//     item, not yet normalized to the PortfolioObjective contract this
//     module maps from)
//   dashboard.opportunities.coveredCallOpportunities (not backed by a
//     scored PortfolioObjective -- no score/tier/explanation to attach
//     honestly)
//   dashboard.opportunities.screenerCandidatesAvailable (a navigation/
//     availability flag, not a ranked recommendation)
// A future sprint may add an explicit adapter for one or more of these;
// silently coercing them into AttentionItem here would mix incompatible
// models, which the CES explicitly forbids.
export function buildAttentionFeed(input: BuildAttentionFeedInput): AttentionFeed {
  const { dashboard, generatedAt } = input;

  const immediate = dashboard.immediateAction.map((entry) => toActionableItem(entry, 'IMMEDIATE', 'IMMEDIATE_ACTION'));

  const watch = [
    ...dashboard.reviewToday.earningsReviews.map((entry) => toActionableItem(entry, 'WATCH', 'EARNINGS_REVIEW')),
    ...dashboard.reviewToday.expiringPositions.map((entry) => toActionableItem(entry, 'WATCH', 'EXPIRING_POSITION')),
    ...dashboard.reviewToday.mediumPriority.map((entry) => toActionableItem(entry, 'WATCH', 'MEDIUM_PRIORITY')),
    ...dashboard.opportunities.rollOpportunities.map((entry) => toActionableItem(entry, 'WATCH', 'ROLL_OPPORTUNITY')),
    ...dashboard.opportunities.cspOpportunities.map((entry) => toActionableItem(entry, 'WATCH', 'CSP_OPPORTUNITY')),
  ];

  const healthy = dashboard.monitor.map(toHealthyItem);

  const orderedActionable = [...immediate, ...watch].sort(compareActionable);
  const topAttentionItem = orderedActionable[0] ?? null;

  return {
    generatedAt,
    immediate,
    watch,
    healthy,
    orderedActionable,
    topAttentionItem,
    counts: {
      immediate: immediate.length,
      watch: watch.length,
      healthy: healthy.length,
      actionable: orderedActionable.length,
    },
  };
}
