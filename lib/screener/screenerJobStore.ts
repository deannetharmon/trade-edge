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
const EVENT_NAME = 'trade-edge:screener-job-state';

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
const listeners = new Set<() => void>();

function safeReadStorage(): ScreenerJobState {
  if (typeof window === 'undefined') return currentState;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return currentState;
    const parsed = JSON.parse(raw) as Partial<ScreenerJobState>;

    // A reload during an in-browser scan cannot reconnect the original async
    // function. Mark an old in-flight job as stopped rather than showing a
    // permanent spinner.
    if (parsed.phase === 'running' && parsed.startedAt && Date.now() - parsed.startedAt > 60 * 60 * 1000) {
      return {
        ...DEFAULT_STATE,
        ...parsed,
        phase: 'stopped',
        status: 'Previous scan no longer active',
        completedAt: Date.now(),
      };
    }

    return { ...DEFAULT_STATE, ...parsed };
  } catch {
    return currentState;
  }
}

function emit(next: ScreenerJobState): void {
  currentState = next;

  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
    try { window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: next })); } catch {}
  }

  listeners.forEach(listener => listener());
}

export function getScreenerJobState(): ScreenerJobState {
  currentState = safeReadStorage();
  return currentState;
}

export function subscribeScreenerJob(listener: () => void): () => void {
  listeners.add(listener);

  if (typeof window !== 'undefined') {
    const onCustom = () => listener();
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) listener();
    };
    window.addEventListener(EVENT_NAME, onCustom);
    window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener(EVENT_NAME, onCustom);
      window.removeEventListener('storage', onStorage);
    };
  }

  return () => listeners.delete(listener);
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
