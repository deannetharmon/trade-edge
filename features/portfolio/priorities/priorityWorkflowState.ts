// features/portfolio/priorities/priorityWorkflowState.ts
//
// PI-0004C: Today's Priorities workflow state (Mark Complete / Reopen).
// This is deliberately separate from lib/portfolio-intelligence -- per the
// sprint brief's explicit model:
//
//   Canonical Portfolio Objective + User Workflow State -> Today's
//   Priorities View
//
// Nothing in this file reads or writes lib/portfolio-intelligence, ranks
// objectives, or changes recommendation content. It only decides, given an
// already-computed, already-ranked PortfolioObjective[] and the trader's
// stored completion state, which bucket (open/completed) each objective
// belongs in for this view -- completion is presentation/workflow state
// layered on top, never a mutation of the canonical objective.

import type { PortfolioObjective } from '@/lib/portfolio-intelligence';

export const PRIORITY_WORKFLOW_STORAGE_KEY = 'hunter-priorities-workflow-state';

export interface PriorityWorkflowEntry {
  completedAt: string; // ISO timestamp, used for "newest completed first" sort
  fingerprint: string; // see computeObjectiveFingerprint()
}

export type PriorityWorkflowState = Record<string, PriorityWorkflowEntry>;

// WAIT is Portfolio Intelligence's own "nothing to do" signal, not a
// recommendation a trader acts on -- per the brief, it can never be marked
// complete.
export function isCompletable(objective: PortfolioObjective): boolean {
  return objective.type !== 'WAIT';
}

// A stable identity for an objective across re-evaluations. objective.id is
// deliberately NOT used here -- it's a random string regenerated on every
// single Portfolio Intelligence run (lib/portfolio-intelligence's own tests
// explicitly assert ids differ across runs while ordering stays stable).
// ruleId + subject is what's actually stable: the same underlying condition
// (this rule, on this position/symbol/portfolio) re-evaluates to the same
// key every time even though the object instance and its id are new.
export function getPriorityWorkflowKey(objective: PortfolioObjective): string {
  const subjectKey = objective.subject.id ?? objective.subject.symbol ?? objective.subject.label;
  return `${objective.ruleId}::${objective.subject.type}::${subjectKey}`;
}

// A content fingerprint used only to detect "this materially changed since
// it was marked complete" -- not an identity (see getPriorityWorkflowKey for
// that). Deliberately excludes createdAt/id: those are regenerated on every
// portfolio refresh even when nothing about the recommendation actually
// changed, and the brief is explicit -- "Do NOT reopen simply because the
// page refreshes." What's included instead is exactly the set of fields a
// trader would consider the substance of the recommendation: priority,
// urgency, actionability (an earnings recommendation becoming actionable is
// an actionability change), the summary text, and supporting evidence
// values (concentration escalating, DTE changing, etc. all show up here).
export function computeObjectiveFingerprint(objective: PortfolioObjective): string {
  const evidence = objective.supportingEvidence
    .map((e) => `${e.id}:${e.value ?? ''}`)
    .join('|');
  return [objective.priority, objective.urgency, objective.actionability, objective.summary, evidence].join('::');
}

export interface PartitionedPriorities {
  // Canonical Portfolio Intelligence ordering, unchanged -- this function
  // never re-sorts the input array, only filters it.
  open: PortfolioObjective[];
  // Sorted newest-completed-first (see partitionPriorities' sort step).
  completed: PortfolioObjective[];
  // The workflow state after auto-reopening any materially-changed
  // completions. Identical to the input `workflowState` (same reference
  // contents) unless reconciliationChanged is true.
  reconciledState: PriorityWorkflowState;
  // True only when an auto-reopen actually happened -- callers should
  // persist reconciledState when this is true, and should NOT persist
  // (or re-render) on every call otherwise.
  reconciliationChanged: boolean;
}

// The one function that decides, for a given canonical objective list and
// the trader's stored completion state, what's Open vs. Completed --
// including auto-reopening items whose underlying objective materially
// changed since completion. Pure: no localStorage, no React, deterministic
// for the same inputs, and never mutates its arguments.
export function partitionPriorities(
  objectives: PortfolioObjective[],
  workflowState: PriorityWorkflowState,
): PartitionedPriorities {
  const open: PortfolioObjective[] = [];
  const completedWithEntry: { objective: PortfolioObjective; entry: PriorityWorkflowEntry }[] = [];
  const nextState: PriorityWorkflowState = { ...workflowState };
  let reconciliationChanged = false;

  for (const objective of objectives) {
    if (!isCompletable(objective)) {
      open.push(objective);
      continue;
    }
    const key = getPriorityWorkflowKey(objective);
    const entry = workflowState[key];
    if (!entry) {
      open.push(objective);
      continue;
    }
    if (computeObjectiveFingerprint(objective) !== entry.fingerprint) {
      // Materially changed since completion -- auto-reopen.
      delete nextState[key];
      reconciliationChanged = true;
      open.push(objective);
      continue;
    }
    completedWithEntry.push({ objective, entry });
  }

  completedWithEntry.sort((a, b) => b.entry.completedAt.localeCompare(a.entry.completedAt));

  return {
    open,
    completed: completedWithEntry.map((c) => c.objective),
    reconciledState: nextState,
    reconciliationChanged,
  };
}

export function markComplete(
  state: PriorityWorkflowState,
  objective: PortfolioObjective,
  now: Date = new Date(),
): PriorityWorkflowState {
  if (!isCompletable(objective)) return state; // WAIT cannot be completed
  const key = getPriorityWorkflowKey(objective);
  return {
    ...state,
    [key]: { completedAt: now.toISOString(), fingerprint: computeObjectiveFingerprint(objective) },
  };
}

export function reopenPriority(state: PriorityWorkflowState, objective: PortfolioObjective): PriorityWorkflowState {
  const key = getPriorityWorkflowKey(objective);
  if (!(key in state)) return state;
  const next = { ...state };
  delete next[key];
  return next;
}

// Persistence: localStorage, matching this app's existing pattern for
// client-only UI/workflow state (LS_THEME, LS_DRY_RUN, LS_SECTION_ORDER in
// app/portfolio/page.tsx) rather than the Redis-backed endpoints used for
// actual trading data (position-intent, position-snapshots). Completion
// state is exactly that kind of client-side workflow preference, and
// localStorage already satisfies the brief's persistence requirement
// (survives refresh, navigation, and browser restart) without a new API
// route or server round-trip.
export function loadPriorityWorkflowState(): PriorityWorkflowState {
  try {
    const raw = localStorage.getItem(PRIORITY_WORKFLOW_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as PriorityWorkflowState) : {};
  } catch {
    return {};
  }
}

export function savePriorityWorkflowState(state: PriorityWorkflowState): void {
  try {
    localStorage.setItem(PRIORITY_WORKFLOW_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Best-effort persistence only (e.g. private browsing, storage quota).
  }
}
