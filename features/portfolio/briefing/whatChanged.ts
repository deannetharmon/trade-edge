// features/portfolio/briefing/whatChanged.ts
//
// PI-0004D: "What Changed" -- meaningful differences since the previous
// refresh, for the Daily Portfolio Briefing. Reuses PI-0004C's identity
// (getPriorityWorkflowKey) and material-change fingerprint
// (computeObjectiveFingerprint) from priorityWorkflowState.ts rather than
// inventing a second notion of "did this change" -- the same fingerprint
// that decides whether a completed priority auto-reopens decides whether an
// item is reported here. WAIT is excluded: it is Portfolio Intelligence's
// own "nothing to do" signal, not a trackable condition.
//
// Persistence: localStorage, matching every other client-only workflow/UI
// state in this app (theme, section order, priorities workflow state).
// On the very first load in a browser there is no stored snapshot to diff
// against -- returning "everything is new" in that case would be noise, not
// signal, so computeWhatChanged returns an empty list when `previous` is
// null (no baseline yet), not the current objective list.

import type { PortfolioObjective, PortfolioObjectiveType } from '@/lib/portfolio-intelligence';
import { computeObjectiveFingerprint, getPriorityWorkflowKey } from '../priorities/priorityWorkflowState';

export const BRIEFING_SNAPSHOT_STORAGE_KEY = 'hunter-briefing-last-snapshot';

export interface BriefingSnapshotEntry {
  fingerprint: string;
  title: string;
  type: PortfolioObjectiveType;
}

export type BriefingSnapshot = Record<string, BriefingSnapshotEntry>;

export type WhatChangedKind = 'new' | 'changed' | 'resolved';

export interface WhatChangedEntry {
  id: string; // stable workflow key, safe for React list keys
  kind: WhatChangedKind;
  label: string;
}

// Builds the snapshot to persist after this refresh's diff has been
// computed. Pure -- takes no localStorage dependency itself.
export function buildBriefingSnapshot(objectives: PortfolioObjective[]): BriefingSnapshot {
  const snapshot: BriefingSnapshot = {};
  for (const objective of objectives) {
    if (objective.type === 'WAIT') continue;
    snapshot[getPriorityWorkflowKey(objective)] = {
      fingerprint: computeObjectiveFingerprint(objective),
      title: objective.title,
      type: objective.type,
    };
  }
  return snapshot;
}

// Pure diff: current objectives vs. the previously stored snapshot.
// `previous === null` means "no baseline exists yet" (first-ever load in
// this browser) -- distinct from `{}` (a previous refresh that was
// legitimately WAIT-only / empty). Only the former suppresses output.
export function computeWhatChanged(
  objectives: PortfolioObjective[] | null,
  previous: BriefingSnapshot | null,
): WhatChangedEntry[] {
  if (!objectives || previous === null) return [];

  const changes: WhatChangedEntry[] = [];
  const currentKeys = new Set<string>();

  for (const objective of objectives) {
    if (objective.type === 'WAIT') continue;
    const key = getPriorityWorkflowKey(objective);
    currentKeys.add(key);
    const prevEntry = previous[key];
    if (!prevEntry) {
      changes.push({ id: key, kind: 'new', label: objective.title });
    } else if (prevEntry.fingerprint !== computeObjectiveFingerprint(objective)) {
      changes.push({ id: key, kind: 'changed', label: objective.title });
    }
  }

  for (const [key, entry] of Object.entries(previous)) {
    if (!currentKeys.has(key)) {
      changes.push({ id: key, kind: 'resolved', label: entry.title });
    }
  }

  return changes;
}

export function loadBriefingSnapshot(): BriefingSnapshot | null {
  try {
    const raw = localStorage.getItem(BRIEFING_SNAPSHOT_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as BriefingSnapshot) : null;
  } catch {
    return null;
  }
}

export function saveBriefingSnapshot(snapshot: BriefingSnapshot): void {
  try {
    localStorage.setItem(BRIEFING_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Best-effort persistence only (e.g. private browsing, storage quota).
  }
}
