// features/portfolio/todaysPriorities/TodaysPrioritiesQueueView.tsx
//
// WA-0003: the new Today's Priorities workspace -- the finite, completion-
// aware, globally-ordered open queue (lib/todays-priorities-queue,
// UNCHANGED canonical engines underneath), reusing the existing completion
// workflow (features/portfolio/priorities/priorityWorkflowState.ts,
// UNCHANGED) verbatim. See
// docs/design/WA-0003-Todays-Priorities-Finite-Queue-CES.md sections 7-9,
// 13-15.
//
// Reuses, rather than clones:
//   - PriorityCard (features/portfolio/components/TodaysPriorities.tsx,
//     exported additively for this purpose) for kind: 'attention' items.
//   - CoveredCallOpportunityRow / NeedsFollowUpRow (extracted, exported
//     additively from features/portfolio/dashboard/TodaysPrioritiesDashboard.tsx)
//     for the two new, non-completable kinds.
//   - loadPriorityWorkflowState / savePriorityWorkflowState / markComplete /
//     reopenPriority / partitionPriorities (priorityWorkflowState.ts,
//     UNCHANGED) for the one shared completion state Priority List also
//     reads/writes.
//
// Owns the level-1 `priority` query-param resolution (CES section 13.1):
// resolves the exact queue item by stableKey (never display text, list
// position, or symbol-only), expands/highlights/scrolls to it, and renders
// a dismissible "no longer open" notice on no match.

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { THEMES, Theme } from '@/lib/theme';
import { PriorityCard } from '../components/TodaysPriorities';
import { CoveredCallOpportunityRow, NeedsFollowUpRow } from '../dashboard/TodaysPrioritiesDashboard';
import {
  isCompletable,
  loadPriorityWorkflowState,
  markComplete,
  reopenPriority,
  savePriorityWorkflowState,
  type PriorityWorkflowState,
} from '../priorities/priorityWorkflowState';
import { partitionTodaysPrioritiesQueue } from '@/lib/todays-priorities-queue';
import type { TodaysPrioritiesQueue, TodaysPrioritiesQueueItem } from '@/lib/todays-priorities-queue';
import { useUrlQueryParam } from './useUrlQueryParam';

// Level-2 destination link (CES section 13.2) -- unchanged mechanics from
// the single-level design this replaces: exact pos.key match for
// position-linked items, exact reviewId for needsFollowUp, unfocused
// Positions for portfolio-level items with no subjectId. Reached only from
// a focused card, never rendered by Mission Control.
function level2Href(item: TodaysPrioritiesQueueItem): string {
  if (item.kind === 'needs_follow_up') {
    return `?tab=history&reviewId=${encodeURIComponent(item.decisionReview!.id)}`;
  }
  if (item.kind === 'covered_call_opportunity') {
    return `?tab=positions&focus=${encodeURIComponent(item.coveredCallOpportunity!.key)}`;
  }
  // kind === 'attention'
  if (item.subjectId) {
    return `?tab=positions&focus=${encodeURIComponent(item.subjectId)}`;
  }
  return '?tab=positions';
}

function level2Label(item: TodaysPrioritiesQueueItem): string {
  if (item.kind === 'needs_follow_up') return 'Open in Decision History →';
  if (item.kind === 'covered_call_opportunity') return 'Open Position →';
  if (item.subjectId) return 'Open Position →';
  return 'Open Positions →';
}

function QueueItemRow({
  item,
  th,
  expanded,
  highlighted,
  onToggle,
  registerRef,
  action,
}: {
  item: TodaysPrioritiesQueueItem;
  th: typeof THEMES[Theme];
  expanded: boolean;
  highlighted: boolean;
  onToggle: () => void;
  registerRef: (el: HTMLDivElement | null) => void;
  action: React.ReactNode;
}) {
  return (
    <div
      ref={registerRef}
      data-stable-key={item.stableKey}
      className={`rounded-xl transition-shadow ${highlighted ? 'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-transparent' : ''}`}
    >
      {item.kind === 'attention' && item.attentionItem?.objective && (
        <PriorityCard objective={item.attentionItem.objective} expanded={expanded} onToggle={onToggle} th={th} renderAction={() => action} />
      )}
      {item.kind === 'covered_call_opportunity' && item.coveredCallOpportunity && (
        <div className={`rounded-xl border ${th.border} ${th.card} p-3`}>
          <CoveredCallOpportunityRow opp={item.coveredCallOpportunity} th={th} />
          <p className={`mt-2 text-[10px] ${th.textFaint}`}>{item.detail}</p>
        </div>
      )}
      {item.kind === 'needs_follow_up' && item.decisionReview && (
        <div className={`rounded-xl border ${th.border} ${th.card} p-3`}>
          <NeedsFollowUpRow review={item.decisionReview} th={th} />
          <p className={`mt-2 text-[10px] ${th.textFaint}`}>{item.detail}</p>
        </div>
      )}
      <div className="mt-1 flex justify-end">
        <a href={level2Href(item)} className={`text-[10px] font-semibold ${th.textFaint} hover:text-[var(--accent)]`}>
          {level2Label(item)}
        </a>
      </div>
    </div>
  );
}

export interface TodaysPrioritiesQueueViewProps {
  queue: TodaysPrioritiesQueue;
  loading: boolean;
  th: typeof THEMES[Theme];
}

export function TodaysPrioritiesQueueView({ queue, loading, th }: TodaysPrioritiesQueueViewProps) {
  const [workflowState, setWorkflowState] = useState<PriorityWorkflowState>({});
  const [stateLoaded, setStateLoaded] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(new Set());
  const [completedExpanded, setCompletedExpanded] = useState(false);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    setWorkflowState(loadPriorityWorkflowState());
    setStateLoaded(true);
  }, []);

  const partition = useMemo(() => partitionTodaysPrioritiesQueue(queue, workflowState), [queue, workflowState]);

  // CES section 13.1: `priority` is a distinct query param from `focus`/
  // `reviewId`, resolved here by exact stableKey match against the OPEN
  // queue -- never by display text, list position, or symbol-only value.
  const focusStableKey = useUrlQueryParam('priority');
  const focusedItem = focusStableKey ? partition.open.find((i) => i.stableKey === focusStableKey) ?? null : null;
  const focusTargetMissing = focusStableKey != null && focusedItem == null;

  useEffect(() => {
    setNoticeDismissed(false);
  }, [focusStableKey]);

  useEffect(() => {
    if (!focusedItem) return;
    setExpandedKeys((prev) => (prev.has(focusedItem.stableKey) ? prev : new Set(prev).add(focusedItem.stableKey)));
    const el = itemRefs.current.get(focusedItem.stableKey);
    // Optional chaining: jsdom (this app's test environment) does not
    // implement scrollIntoView -- guarding here is a test-environment
    // accommodation only, not a behavior change in a real browser.
    el?.scrollIntoView?.({ block: 'center' });
  }, [focusedItem]);

  const handleComplete = (item: TodaysPrioritiesQueueItem) => {
    const objective = item.attentionItem?.objective;
    if (!objective) return;
    setWorkflowState((prev) => {
      const next = markComplete(prev, objective);
      savePriorityWorkflowState(next);
      return next;
    });
  };

  const handleReopen = (item: TodaysPrioritiesQueueItem) => {
    const objective = item.attentionItem?.objective;
    if (!objective) return;
    setWorkflowState((prev) => {
      const next = reopenPriority(prev, objective);
      savePriorityWorkflowState(next);
      return next;
    });
  };

  const toggle = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  if (loading && !stateLoaded) {
    return (
      <section className="mx-6 mt-4" aria-label="Today's Priorities">
        <div className={`rounded-xl border ${th.border} ${th.card} p-6 text-center`}>
          <p className={`text-[11px] ${th.textFaint}`}>Loading priorities&hellip;</p>
        </div>
      </section>
    );
  }

  return (
    <div className="mx-6 mt-4 space-y-6">
      {focusTargetMissing && !noticeDismissed && (
        <div role="status" className={`flex items-center justify-between rounded-lg border border-amber-600/60 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300`}>
          <span>This priority is no longer open.</span>
          <button type="button" onClick={() => setNoticeDismissed(true)} className="ml-3 shrink-0 text-amber-400 hover:text-amber-200">
            Dismiss
          </button>
        </div>
      )}

      <section aria-label="Open Priorities">
        <div className="mb-3 flex items-center justify-between">
          <h2 className={`text-[11px] font-bold uppercase tracking-widest ${th.textFaint}`}>Open Priorities</h2>
          <span className={`text-[9px] ${th.textFaint}`}>{partition.openCount} item{partition.openCount !== 1 ? 's' : ''}</span>
        </div>
        {partition.open.length === 0 ? (
          <div className={`rounded-xl border ${th.border} ${th.card} p-6 text-center`}>
            <p className={`text-[12px] ${th.textFaint}`}>Nothing needs your attention right now.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {partition.open.map((item) => (
              <QueueItemRow
                key={item.stableKey}
                item={item}
                th={th}
                expanded={expandedKeys.has(item.stableKey)}
                highlighted={focusedItem?.stableKey === item.stableKey}
                onToggle={() => toggle(item.stableKey)}
                registerRef={(el) => {
                  if (el) itemRefs.current.set(item.stableKey, el);
                  else itemRefs.current.delete(item.stableKey);
                }}
                action={
                  item.kind === 'attention' && item.attentionItem?.objective && isCompletable(item.attentionItem.objective) ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleComplete(item);
                      }}
                      className="shrink-0 rounded border border-emerald-600 px-2 py-1 text-[10px] font-semibold tracking-wide text-emerald-400 transition-colors hover:bg-emerald-500/10"
                    >
                      Mark Complete
                    </button>
                  ) : null
                }
              />
            ))}
          </div>
        )}
      </section>

      {partition.completed.length > 0 && (
        <section aria-label="Completed Priorities">
          <button
            type="button"
            onClick={() => setCompletedExpanded((v) => !v)}
            className="mb-3 flex w-full items-center justify-between"
            aria-expanded={completedExpanded}
          >
            <h2 className={`text-[11px] font-bold uppercase tracking-widest ${th.textFaint}`}>
              Completed Priorities {completedExpanded ? '▲' : '▼'}
            </h2>
            <span className={`text-[9px] ${th.textFaint}`}>{partition.completedCount} item{partition.completedCount !== 1 ? 's' : ''}</span>
          </button>
          {completedExpanded && (
            <div className="space-y-2">
              {partition.completed.map((item) => (
                <QueueItemRow
                  key={item.stableKey}
                  item={item}
                  th={th}
                  expanded={expandedKeys.has(item.stableKey)}
                  highlighted={false}
                  onToggle={() => toggle(item.stableKey)}
                  registerRef={(el) => {
                    if (el) itemRefs.current.set(item.stableKey, el);
                    else itemRefs.current.delete(item.stableKey);
                  }}
                  action={
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleReopen(item);
                      }}
                      className={`shrink-0 rounded border px-2 py-1 text-[10px] font-semibold tracking-wide transition-colors ${th.border} ${th.textFaint} hover:text-white/80 hover:border-white/40`}
                    >
                      Reopen
                    </button>
                  }
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
