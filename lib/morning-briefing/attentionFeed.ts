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
//   - selectTopPriority()                   (left completely untouched --
//                                             topAttentionItem below is
//                                             resolved FROM its answer, not
//                                             re-derived independently; see
//                                             the corrective-round note
//                                             above buildAttentionFeed()).
//
// This module only flattens, labels-by-origin, deduplicates, and globally
// orders what those producers already computed.
//
// Corrective round (Quinn's review, docs/reviews/MB-0001A-Quinn-Architecture-Review.md):
// the initial version flattened every source bucket independently, which
// (a) could surface the same PortfolioObjective more than once, since
// buildTodaysPrioritiesDashboard() intentionally lets one objective belong
// to more than one bucket, and (b) computed topAttentionItem from this
// module's own orderedActionable head, which is not guaranteed to agree
// with the existing selectTopPriority() when different-bucket heads tie at
// the same score (the two functions' tie-break rules are allowed to
// differ). Both are corrected below: buildAttentionFeed() now deduplicates
// by objective.id (highest source-precedence occurrence wins, every other
// occurrence dropped, not merged or re-scored) before building
// immediate/watch/orderedActionable, and topAttentionItem is resolved from
// selectTopPriority(dashboard)'s own answer, looked up by objective id in
// the already-deduplicated feed -- never independently re-derived.

import {
  buildRecommendationExplanation,
  selectTopPriority,
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
// first when scores tie in compareActionable(). Quinn's corrective review
// reuses this exact same ordering as the deduplication precedence in
// buildAttentionFeed() below -- one objective appearing in multiple source
// buckets keeps whichever bucket has the lowest index here. MONITOR is
// included only so the map stays total over every AttentionSource;
// MONITOR-banded items never enter orderedActionable or the dedup pass
// (they are not actionable -- see toHealthyItem below), so this value is
// never actually consulted by either.
const SOURCE_PRECEDENCE: Record<AttentionSource, number> = {
  IMMEDIATE_ACTION: 0,
  EARNINGS_REVIEW: 1,
  EXPIRING_POSITION: 2,
  MEDIUM_PRIORITY: 3,
  ROLL_OPPORTUNITY: 4,
  CSP_OPPORTUNITY: 5,
  MONITOR: 6,
};

// The six actionable source buckets, walked in source-precedence order --
// both for deduplication (buildAttentionFeed() keeps the first, i.e.
// highest-precedence, occurrence of each objective.id) and as each item's
// band. Declared once here so bucket set/order cannot drift between the
// dedup pass and SOURCE_PRECEDENCE above.
interface ActionableSourceBucket {
  source: AttentionSource;
  band: 'IMMEDIATE' | 'WATCH';
  entries: PrioritizedObjective[];
}

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

  const buckets: ActionableSourceBucket[] = [
    { source: 'IMMEDIATE_ACTION', band: 'IMMEDIATE', entries: dashboard.immediateAction },
    { source: 'EARNINGS_REVIEW', band: 'WATCH', entries: dashboard.reviewToday.earningsReviews },
    { source: 'EXPIRING_POSITION', band: 'WATCH', entries: dashboard.reviewToday.expiringPositions },
    { source: 'MEDIUM_PRIORITY', band: 'WATCH', entries: dashboard.reviewToday.mediumPriority },
    { source: 'ROLL_OPPORTUNITY', band: 'WATCH', entries: dashboard.opportunities.rollOpportunities },
    { source: 'CSP_OPPORTUNITY', band: 'WATCH', entries: dashboard.opportunities.cspOpportunities },
  ];

  // Finding A (duplicate logical attention items): walk buckets in
  // source-precedence order and keep only the first occurrence of each
  // objective.id. buildTodaysPrioritiesDashboard() intentionally allows one
  // objective to belong to more than one bucket (e.g. a CRITICAL
  // DEPLOY_IDLE_CASH objective is both Immediate Action and a CSP
  // Opportunity) -- that is correct for its own per-section presentation,
  // but a unified attention feed must answer "what deserves attention" once
  // per decision, not once per dashboard taxonomy membership. Every
  // lower-precedence duplicate is dropped entirely; identity, score, tier,
  // reasons, and explanation of the retained occurrence are unchanged.
  const dedupedById = new Map<string, AttentionItem>();
  for (const bucket of buckets) {
    for (const entry of bucket.entries) {
      const id = entry.objective.id;
      if (dedupedById.has(id)) continue;
      dedupedById.set(id, toActionableItem(entry, bucket.band, bucket.source));
    }
  }

  const deduped = Array.from(dedupedById.values());
  const immediate = deduped.filter((item) => item.band === 'IMMEDIATE');
  const watch = deduped.filter((item) => item.band === 'WATCH');
  const healthy = dashboard.monitor.map(toHealthyItem);

  const orderedActionable = [...deduped].sort(compareActionable);

  // Finding B (top-item parity): do not re-derive the top item from this
  // module's own ordering. selectTopPriority() is the existing, untouched,
  // canonical selector for "what's the single most urgent thing" -- its
  // answer is authoritative here by construction, resolved into this
  // already-deduplicated feed by objective id. Every objective
  // selectTopPriority() can return comes from one of the six buckets above,
  // so the lookup below always succeeds when it returns non-null; the
  // fallback to null is defensive only, never expected to trigger for
  // structurally valid input.
  const topPriority = selectTopPriority(dashboard);
  const topAttentionItem = topPriority ? (dedupedById.get(topPriority.objective.id) ?? null) : null;

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
