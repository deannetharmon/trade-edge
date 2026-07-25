// lib/todays-priorities-queue/buildTodaysPrioritiesQueue.ts
//
// WA-0003: the one new, additive composition function this sprint
// introduces. Calls buildAttentionFeed() (lib/morning-briefing, UNCHANGED)
// for the scored/globally-ordered portion, then appends covered-call
// opportunities and needsFollowUp decision reviews -- two already-computed,
// already-typed collections buildAttentionFeed() deliberately excludes (see
// its own module doc) -- as two new, honestly-non-completable queue-item
// kinds. No canonical engine changes; no new scoring; no new eligibility
// intelligence invented anywhere. See
// docs/design/WA-0003-Todays-Priorities-Finite-Queue-CES.md sections 4, 6, 7.

import { buildAttentionFeed } from '@/lib/morning-briefing';
import type { AttentionItem } from '@/lib/morning-briefing';
import type { TodaysPrioritiesDashboard } from '@/lib/todaysPriorities';
import {
  getPriorityWorkflowKey,
  isCompletable,
  partitionPriorities,
  type PriorityWorkflowState,
} from '@/features/portfolio/priorities/priorityWorkflowState';
import type {
  TodaysPrioritiesQueue,
  TodaysPrioritiesQueueItem,
  TodaysPrioritiesQueuePartition,
} from './types';

export interface BuildTodaysPrioritiesQueueInput {
  dashboard: TodaysPrioritiesDashboard;
  generatedAt: string;
}

// Corrective ruling (CES section 7/13): the single derivation point for
// every queue item's deep-link identifier. Computed once, here, at queue-
// build time -- never recomputed independently by Mission Control or by
// Today's Priorities. The `attention::` / `cc::` / `review::` namespace
// prefix is what prevents collisions across kinds even when the underlying
// identifiers could otherwise coincide (e.g. a covered-call opportunity's
// position key and an attention item's subjectKey are drawn from the same
// position-key space).
export function getStableQueueKey(item: TodaysPrioritiesQueueItem): string {
  switch (item.kind) {
    case 'attention': {
      const objective = item.attentionItem?.objective;
      if (!objective) {
        // Defensive only -- every 'attention' item is always built from an
        // AttentionItem whose `objective` is non-null (buildAttentionFeed()
        // never surfaces objective-less actionable items). Falls back to the
        // AttentionItem's own id, still namespaced, rather than throwing.
        return `attention::${item.attentionItem?.id ?? item.id}`;
      }
      return `attention::${getPriorityWorkflowKey(objective)}`;
    }
    case 'covered_call_opportunity':
      return `cc::${item.coveredCallOpportunity!.key}`;
    case 'needs_follow_up':
      return `review::${item.decisionReview!.id}`;
  }
}

function toAttentionQueueItem(attentionItem: AttentionItem): TodaysPrioritiesQueueItem {
  const objective = attentionItem.objective;
  const item: TodaysPrioritiesQueueItem = {
    kind: 'attention',
    id: attentionItem.id,
    stableKey: '', // populated below, after construction (getStableQueueKey needs `item`)
    subjectId: attentionItem.subjectId,
    headline: attentionItem.headline,
    detail: attentionItem.recommendedAction,
    completable: objective != null && isCompletable(objective),
    attentionItem,
  };
  item.stableKey = getStableQueueKey(item);
  return item;
}

export function buildTodaysPrioritiesQueue(input: BuildTodaysPrioritiesQueueInput): TodaysPrioritiesQueue {
  const { dashboard, generatedAt } = input;

  const attentionFeed = buildAttentionFeed({ dashboard, generatedAt });

  const attentionItems = attentionFeed.orderedActionable.map(toAttentionQueueItem);

  // Covered-call opportunities: not PortfolioObjective-backed, never
  // completable (structural, not a runtime flag). Existing array order
  // (dashboardComposition.ts's) preserved as-is -- no new sort invented.
  const coveredCallItems: TodaysPrioritiesQueueItem[] = dashboard.opportunities.coveredCallOpportunities.map((opp) => {
    const item: TodaysPrioritiesQueueItem = {
      kind: 'covered_call_opportunity',
      id: opp.key,
      stableKey: '',
      subjectId: opp.key,
      headline: `${opp.symbol} — Sell Covered Call`,
      detail: `${opp.shares} uncovered shares available for a covered call.`,
      completable: false,
      coveredCallOpportunity: opp,
    };
    item.stableKey = getStableQueueKey(item);
    return item;
  });

  // Decision-review follow-ups: the position is already closed (see
  // lib/decision-review's reviewsNeedingFollowUp() doc). Never completable
  // -- resolves via its own existing Decision Review outcome workflow, not
  // Mark Complete. Existing array order preserved.
  const needsFollowUpItems: TodaysPrioritiesQueueItem[] = dashboard.reviewToday.needsFollowUp.map((review) => {
    const item: TodaysPrioritiesQueueItem = {
      kind: 'needs_follow_up',
      id: review.id,
      stableKey: '',
      subjectId: null,
      headline: `${review.symbol} ${review.strategy} — Record Outcome`,
      detail: 'This closed position has a pending Decision Review awaiting an outcome.',
      completable: false,
      decisionReview: review,
    };
    item.stableKey = getStableQueueKey(item);
    return item;
  });

  const orderedItems = [...attentionItems, ...coveredCallItems, ...needsFollowUpItems];

  return {
    generatedAt,
    orderedItems,
    leadItem: orderedItems[0] ?? null,
    counts: { total: orderedItems.length },
  };
}

// Partitions a queue against the trader's stored completion state, reusing
// partitionPriorities() (features/portfolio/priorities/priorityWorkflowState.ts)
// UNMODIFIED -- only its input array is newly sourced from the queue's
// attention-kind items instead of directly from canonicalPriorities.objectives
// (CES section 5/7). covered_call_opportunity and needs_follow_up items are
// always open (never completable, never partitioned).
export function partitionTodaysPrioritiesQueue(
  queue: TodaysPrioritiesQueue,
  workflowState: PriorityWorkflowState,
): TodaysPrioritiesQueuePartition {
  const objectivesFromQueue = queue.orderedItems
    .filter((i): i is TodaysPrioritiesQueueItem & { attentionItem: AttentionItem } => i.kind === 'attention' && i.attentionItem?.objective != null)
    .map((i) => i.attentionItem.objective!);

  const { open, completed } = partitionPriorities(objectivesFromQueue, workflowState);

  // Never key by objective.id across runs (ids regenerate every
  // computation) -- use the same stable key partitionPriorities() itself
  // uses internally.
  const openKeys = new Set(open.map(getPriorityWorkflowKey));

  const openItems = queue.orderedItems.filter((item) => {
    if (item.kind !== 'attention') return true;
    const objective = item.attentionItem?.objective;
    if (!objective) return true;
    if (!isCompletable(objective)) return true;
    return openKeys.has(getPriorityWorkflowKey(objective));
  });

  const completedKeys = new Set(completed.map(getPriorityWorkflowKey));
  const completedItems = queue.orderedItems.filter((item) => {
    if (item.kind !== 'attention') return false;
    const objective = item.attentionItem?.objective;
    if (!objective) return false;
    return completedKeys.has(getPriorityWorkflowKey(objective));
  });

  // Preserve completed's newest-first sort order (already produced by
  // partitionPriorities()) rather than the queue's own order.
  const completedByKey = new Map(completedItems.map((item) => [getPriorityWorkflowKey(item.attentionItem!.objective!), item]));
  const orderedCompleted = completed
    .map((objective) => completedByKey.get(getPriorityWorkflowKey(objective)))
    .filter((item): item is TodaysPrioritiesQueueItem => item != null);

  return {
    open: openItems,
    completed: orderedCompleted,
    leadItem: openItems[0] ?? null,
    openCount: openItems.length,
    completedCount: orderedCompleted.length,
  };
}
