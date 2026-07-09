'use client';

import { useSyncExternalStore } from 'react';

export type ScreenerJobKind = 'filter' | 'rank' | 'targeted' | 'pmcc' | 'csp' | 'passive';
export type ScreenerJobPhase = 'idle' | 'running' | 'complete' | 'error' | 'stopped';

export interface ScreenerJobState {
  id: string | null;
  kind: ScreenerJobKind | null;
  phase: ScreenerJobPhase;
  label: string;
  status: string;
  progressCurrent: number;
  progressTotal: number;
  resultCount: number | null;
  startedAt: number | null;
  completedAt: number | null;
  error: string | null;
  resultsHref: string;
}

const STORAGE_KEY = 'trade-edge-screener-job-state';

const DEFAULT_STATE: ScreenerJobState = {
  id: null,
  kind: null,
  phase: 'idle',
  label: '',
  status: '',
  progressCurrent: 0,
  progressTotal: 0,
  resultCount: null,
  startedAt: null,
  completedAt: null,
  error: null,
  resultsHref: '/screener',
};

let currentState: ScreenerJobState = DEFAULT_STATE;
let didHydrateFromStorage = false;
const listeners = new Set<() => void>();

function normalizeState(parsed: Partial<ScreenerJobState>, fromStorage = false): ScreenerJobState {
  const next = { ...DEFAULT_STATE, ...parsed };

  // Completed/error/stopped cards are transient UI. They should survive normal
  // in-app navigation through the in-memory store, but they should not resurrect
  // after a hard reload from localStorage.
  if (fromStorage && next.phase !== 'running') {
    return DEFAULT_STATE;
  }

  // A full reload cannot reconnect an in-browser async scan. Mark an old
  // in-flight job as stopped rather than leaving a permanent spinner.
  if (next.phase === 'running' && next.startedAt && Date.now() - next.startedAt > 60 * 60 * 1000) {
    return {
      ...next,
      phase: 'stopped',
      status: 'Previous scan no longer active',
      completedAt: Date.now(),
    };
  }

  return next;
}

function hydrateFromStorageOnce(): void {
  if (didHydrateFromStorage || typeof window === 'undefined') return;
  didHydrateFromStorage = true;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    currentState = normalizeState(JSON.parse(raw) as Partial<ScreenerJobState>, true);
    if (currentState.phase === 'idle') {
      try { window.localStorage.removeItem(STORAGE_KEY); } catch {}
    }
  } catch {
    currentState = DEFAULT_STATE;
  }
}

function persist(next: ScreenerJobState): void {
  if (typeof window === 'undefined') return;
  try {
    if (next.phase === 'idle') window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
}

function notify(): void {
  listeners.forEach(listener => listener());
}

function emit(next: ScreenerJobState): void {
  currentState = next;
  didHydrateFromStorage = true;
  persist(next);
  notify();
}

export function getScreenerJobState(): ScreenerJobState {
  hydrateFromStorageOnce();
  return currentState;
}

export function subscribeScreenerJob(listener: () => void): () => void {
  hydrateFromStorageOnce();
  listeners.add(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    try {
      currentState = event.newValue
        ? normalizeState(JSON.parse(event.newValue) as Partial<ScreenerJobState>, true)
        : DEFAULT_STATE;
    } catch {
      currentState = DEFAULT_STATE;
    }
    notify();
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
  }

  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage);
    }
  };
}

export function useScreenerJobState(): ScreenerJobState {
  return useSyncExternalStore(subscribeScreenerJob, getScreenerJobState, () => DEFAULT_STATE);
}

export function startScreenerJob(args: {
  kind: ScreenerJobKind;
  label: string;
  total?: number;
  status?: string;
  resultsHref?: string;
}): string {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  emit({
    ...DEFAULT_STATE,
    id,
    kind: args.kind,
    phase: 'running',
    label: args.label,
    status: args.status ?? 'Starting scan...',
    progressCurrent: 0,
    progressTotal: args.total ?? 0,
    startedAt: Date.now(),
    resultsHref: args.resultsHref ?? '/screener',
  });
  return id;
}

export function updateScreenerJob(patch: Partial<ScreenerJobState>): void {
  emit({ ...getScreenerJobState(), ...patch });
}

export function completeScreenerJob(args: { resultCount?: number | null; status?: string; resultsHref?: string } = {}): void {
  const prev = getScreenerJobState();
  emit({
    ...prev,
    phase: 'complete',
    status: args.status ?? 'Scan complete',
    resultCount: args.resultCount ?? prev.resultCount,
    completedAt: Date.now(),
    error: null,
    resultsHref: args.resultsHref ?? prev.resultsHref ?? '/screener',
  });
}

export function failScreenerJob(error: string): void {
  const prev = getScreenerJobState();
  emit({
    ...prev,
    phase: 'error',
    status: 'Scan failed',
    error,
    completedAt: Date.now(),
  });
}

export function stopScreenerJob(status = 'Scan stopped'): void {
  const prev = getScreenerJobState();
  emit({
    ...prev,
    phase: 'stopped',
    status,
    completedAt: Date.now(),
  });
}

export function clearScreenerJob(): void {
  emit(DEFAULT_STATE);
}
