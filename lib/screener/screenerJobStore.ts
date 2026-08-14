'use client';

import { useSyncExternalStore } from 'react';

export type ScreenerJobKind = 'filter' | 'rank' | 'targeted' | 'pmcc' | 'csp' | 'cc' | 'passive';
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
  // PO corrective round 4 (WA-0005 Finding 2): the authoritative "last
  // completed results-affecting job" identity, held here as COMMITTED,
  // external-store state -- never a ref mutated during a React render body.
  //
  // Prior architecture (round 3) held this value in a separate hook
  // (lib/command-center/useLatestResultsAffectingJobId.ts) via a `useRef`
  // mutated synchronously during render. Round 4's review found that
  // unsound: a render that mutates a ref can occur without that render
  // ever committing (a discarded render pass, an error boundary unwind, a
  // concurrent-mode interruption, or a StrictMode development double-
  // invocation), so a ref mutated mid-render is not a reliable place to
  // record "this job authoritatively completed." It also didn't atomically
  // bind a specific job id to the specific `results` array that job
  // produced -- the ref and the page's own `results` state were two
  // independently-updated values that could, in principle, drift apart in
  // intermediate renders.
  //
  // Corrected architecture: this field is set by completeScreenerJob()
  // itself, as part of the SAME `emit()` call that transitions `phase` to
  // 'complete' -- i.e. in the exact same synchronous, committed external-
  // store update every results-affecting scan producer (runScreen/
  // runPMCCScan/runCspScan/useRankedScan's real TaskManager-driven effect)
  // already calls immediately alongside its own `setResults(...)` call, in
  // the same synchronous function body, with no `await` in between. Because
  // `emit()` mutates `currentState` synchronously (before `notify()` even
  // runs), any render that reads this field via `useScreenerJobState()`
  // (a `useSyncExternalStore` subscription) is guaranteed to see the
  // fully-updated value -- there is no possible intermediate render where
  // `results` has advanced but this field has not, the way there could be
  // with a `useEffect`+`setState` pair one render behind. See
  // completeScreenerJob() below for exactly how it is derived (never
  // cleared by a later job merely starting ('running') or failing
  // ('error'); Targeted Scan is structurally excluded since it writes to
  // `targetedResults`, not `results`, and cannot affect the recommendations
  // pipeline).
  lastResultsAffectingJobId: string | null;
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
  lastResultsAffectingJobId: null,
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
  // PO corrective round 4 (WA-0005 Defect 2): previously spread
  // `...DEFAULT_STATE`, which reset `lastResultsAffectingJobId` to `null`
  // on every new job start -- the exact defect this field exists to avoid
  // (a later job merely STARTING must never erase a prior genuinely
  // completed job's identity). Now preserves the current
  // `lastResultsAffectingJobId` explicitly, spreading only the other
  // DEFAULT_STATE fields (a fresh job's progress/status/error/etc. still
  // resets normally).
  const prev = getScreenerJobState();
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
    lastResultsAffectingJobId: prev.lastResultsAffectingJobId,
  });
  return id;
}

export function updateScreenerJob(patch: Partial<ScreenerJobState>): void {
  emit({ ...getScreenerJobState(), ...patch });
}

export function completeScreenerJob(args: { resultCount?: number | null; status?: string; resultsHref?: string } = {}): void {
  const prev = getScreenerJobState();
  // PO corrective round 4 (WA-0005 Finding 2): the completing job's own id
  // becomes the new `lastResultsAffectingJobId` -- captured HERE, as part of
  // this same atomic emit(), the exact moment the job that produced new
  // `results` (via the caller's own synchronous, same-tick setResults(...)
  // call) reaches 'complete'. Targeted Scan is excluded (it writes to
  // targetedResults, not results, and cannot affect the recommendations
  // pipeline); if this completion is not results-affecting, the field is
  // left exactly as it was -- never cleared -- so a later job merely
  // starting or failing can never erase a genuinely prior completed job's
  // identity (the defect this replaces).
  const isResultsAffecting = !!prev.kind && prev.kind !== 'targeted' && !!prev.id;
  emit({
    ...prev,
    phase: 'complete',
    status: args.status ?? 'Scan complete',
    resultCount: args.resultCount ?? prev.resultCount,
    completedAt: Date.now(),
    error: null,
    resultsHref: args.resultsHref ?? prev.resultsHref ?? '/screener',
    lastResultsAffectingJobId: isResultsAffecting ? (prev.id as string) : prev.lastResultsAffectingJobId,
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
