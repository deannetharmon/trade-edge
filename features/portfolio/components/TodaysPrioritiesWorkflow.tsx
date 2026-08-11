// features/portfolio/components/TodaysPrioritiesWorkflow.tsx
//
// PI-0004C: the Today's Priorities Portfolio subpage. Composes the existing,
// unmodified-in-spirit TodaysPriorities renderer (called twice: once for
// Open, once for Completed) with the workflow-state module
// (features/portfolio/priorities/priorityWorkflowState.ts) to add Mark
// Complete / Reopen. This component owns UI state (which section an item is
// in, right now, in this browser) -- it does not evaluate, rank, or alter
// any PortfolioObjective. Per the sprint brief's model:
//
//   Canonical Portfolio Objective + User Workflow State -> Today's
//   Priorities View
//
// This *is* that View.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { THEMES, Theme } from '@/lib/theme';
import type { PortfolioObjective } from '@/lib/portfolio-intelligence';
import { TodaysPriorities } from './TodaysPriorities';
import { VerifyPricingObjectiveRefreshButton, type PricingRefreshOutcome } from './VerifyPricingRefreshButton';
import type { PortfolioRefreshResult } from '@/components/portfolio-data/PortfolioDataProvider';
import {
  isCompletable,
  loadPriorityWorkflowState,
  markComplete,
  partitionPriorities,
  reopenPriority,
  savePriorityWorkflowState,
  type PriorityWorkflowState,
} from '../priorities/priorityWorkflowState';

export interface TodaysPrioritiesWorkflowProps {
  objectives: PortfolioObjective[] | null;
  loading: boolean;
  th: typeof THEMES[Theme];
  onRefreshQuotes?: () => Promise<PortfolioRefreshResult>;
  portfolioRefreshing?: boolean;
  onPricingRefreshOutcome?: (outcome: PricingRefreshOutcome | null) => void;
}

export function TodaysPrioritiesWorkflow({ objectives, loading, th, onRefreshQuotes, portfolioRefreshing = false, onPricingRefreshOutcome }: TodaysPrioritiesWorkflowProps) {
  const [workflowState, setWorkflowState] = useState<PriorityWorkflowState>({});
  // Guards against writing an empty {} back over real stored state before
  // the initial localStorage read completes (both run in the same tick on
  // mount, but this makes the ordering explicit rather than relying on it).
  const [stateLoaded, setStateLoaded] = useState(false);

  useEffect(() => {
    setWorkflowState(loadPriorityWorkflowState());
    setStateLoaded(true);
  }, []);

  // Auto-reopen: whenever a fresh objectives list arrives, reconcile it
  // against stored completions and persist ONLY if something was actually
  // auto-reopened (partitionPriorities' reconciliationChanged flag) --
  // never on every render, and never merely because the page refreshed with
  // nothing materially different (see that function's fingerprint
  // comparison for what counts as "materially different").
  useEffect(() => {
    if (!stateLoaded || !objectives) return;
    const { reconciledState, reconciliationChanged } = partitionPriorities(objectives, workflowState);
    if (reconciliationChanged) {
      setWorkflowState(reconciledState);
      savePriorityWorkflowState(reconciledState);
    }
    // Intentionally keyed on `objectives` (a fresh Portfolio Intelligence
    // computation) and `stateLoaded`, not `workflowState` -- this effect's
    // own setWorkflowState call must not re-trigger itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectives, stateLoaded]);

  const handleComplete = useCallback((objective: PortfolioObjective) => {
    setWorkflowState((prev) => {
      const next = markComplete(prev, objective);
      savePriorityWorkflowState(next);
      return next;
    });
  }, []);

  const handleReopen = useCallback((objective: PortfolioObjective) => {
    setWorkflowState((prev) => {
      const next = reopenPriority(prev, objective);
      savePriorityWorkflowState(next);
      return next;
    });
  }, []);

  if (objectives === null) {
    return <TodaysPriorities objectives={null} loading={loading} th={th} title="Today's Priorities" />;
  }

  const { open, completed } = partitionPriorities(objectives, workflowState);

  return (
    <div className="space-y-6">
      <TodaysPriorities
        objectives={open}
        loading={loading}
        th={th}
        title="Open Priorities"
        renderAction={(objective) => {
          if (objective.ruleId === 'OBJ-VERIFY-PRICING' && onRefreshQuotes && onPricingRefreshOutcome) {
            return (
              <VerifyPricingObjectiveRefreshButton
                objective={objective}
                portfolioRefreshing={portfolioRefreshing}
                onRefresh={onRefreshQuotes}
                onOutcome={onPricingRefreshOutcome}
              />
            );
          }
          return isCompletable(objective) ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleComplete(objective);
              }}
              className="shrink-0 rounded border border-emerald-600 px-2 py-1 text-[10px] font-semibold tracking-wide text-emerald-400 transition-colors hover:bg-emerald-500/10"
            >
              Mark Complete
            </button>
          ) : null;
        }}
      />

      {completed.length > 0 && (
        <TodaysPriorities
          objectives={completed}
          loading={false}
          th={th}
          title="Completed Priorities"
          renderAction={(objective) => (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleReopen(objective);
              }}
              className={`shrink-0 rounded border px-2 py-1 text-[10px] font-semibold tracking-wide transition-colors ${th.border} ${th.textFaint} hover:text-white/80 hover:border-white/40`}
            >
              Reopen
            </button>
          )}
        />
      )}
    </div>
  );
}
