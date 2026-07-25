// lib/todays-priorities-queue/types.ts
//
// WA-0003: Today's Priorities Finite Queue -- the one additive, canonical
// composition over buildAttentionFeed() (lib/morning-briefing, UNCHANGED)
// that both Today's Priorities and Mission Control consume, per the
// approved CES (docs/design/WA-0003-Todays-Priorities-Finite-Queue-CES.md,
// section 7). No new scoring, ranking, or eligibility intelligence is
// introduced anywhere in this package -- every field below is read directly
// from an existing, already-typed producer output.

import type { AttentionItem } from '@/lib/morning-briefing';
import type { CoveredCallOpportunityInput } from '@/lib/todaysPriorities';
import type { DecisionReview } from '@/lib/decision-review';

export type TodaysPrioritiesQueueItemKind = 'attention' | 'covered_call_opportunity' | 'needs_follow_up';

export interface TodaysPrioritiesQueueItem {
  kind: TodaysPrioritiesQueueItemKind;
  // AttentionItem.id, CC opportunity's key, or DecisionReview.id -- unchanged
  // upstream identifiers, kept for display/debugging; NEVER used as the
  // deep-link identifier (see stableKey below).
  id: string;
  // Corrective ruling: namespaced, deterministic, kind-agnostic identifier
  // for deep-link focus (CES section 7 / getStableQueueKey()). Never display
  // text, list position, or symbol-only.
  stableKey: string;
  // Position key, when this item corresponds to exactly one position; null
  // for portfolio-level attention items and for needs_follow_up items
  // (whose position is already closed -- see decisionReview.ts).
  subjectId: string | null;
  headline: string;
  detail: string;
  // True only for kind === 'attention' items whose underlying objective is
  // completable (see priorityWorkflowState.ts's isCompletable()). Always
  // false, structurally, for the other two kinds -- not a runtime check
  // that could be bypassed.
  completable: boolean;
  // Exactly one of the following three is populated, matching `kind`.
  attentionItem?: AttentionItem;
  coveredCallOpportunity?: CoveredCallOpportunityInput;
  decisionReview?: DecisionReview;
}

export interface TodaysPrioritiesQueue {
  generatedAt: string;
  // Scored items (via buildAttentionFeed's global Priority Score order)
  // first, then covered-call opportunities, then needsFollowUp -- each
  // appended group in its own existing, stable input order. No new sorting
  // is invented for the appended groups.
  orderedItems: TodaysPrioritiesQueueItem[];
  // orderedItems[0], or null if empty. This is the FULL queue's lead item
  // (completion-agnostic) -- the queue builder itself never reads workflow
  // state; callers partition/filter separately (see partitionTodaysPrioritiesQueue).
  leadItem: TodaysPrioritiesQueueItem | null;
  counts: { total: number };
}

export interface TodaysPrioritiesQueuePartition {
  // Open items, in the queue's existing global order (never re-sorted).
  open: TodaysPrioritiesQueueItem[];
  // Completed attention items, sorted newest-completed-first via the same
  // partitionPriorities() sort (unchanged). Only kind === 'attention' items
  // are ever completed.
  completed: TodaysPrioritiesQueueItem[];
  leadItem: TodaysPrioritiesQueueItem | null;
  openCount: number;
  completedCount: number;
}
