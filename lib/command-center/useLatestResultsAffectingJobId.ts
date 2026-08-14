'use client';

// lib/command-center/useLatestResultsAffectingJobId.ts
//
// WA-0005 §16, PO corrective round 4 (Defect 2): the authoritative "last
// completed results-affecting scan job" identity, now sourced ENTIRELY from
// committed, external-store state (lib/screener/screenerJobStore.ts's own
// `lastResultsAffectingJobId` field) -- never a ref mutated during render.
//
// History: round 3 introduced this hook to fix a real bug (deriving the
// value by reading the LIVE job's phase inline on every render, which went
// `null` the instant a new scan started running or failed). Round 3's own
// fix held the corrected value in a `useRef` mutated synchronously during
// THIS hook's render body, reasoning that a sibling `useEffect`+`setState`
// pair would be one render late relative to the recommendations-fetch
// effect (keyed on `[results]`).
//
// Round 4's Product Owner review found round 3's ref-during-render fix
// itself unsound, for a different reason than the one it was chasing: a
// React render that mutates a ref can occur without that render ever
// committing (React discarding a render pass, an error boundary unwinding,
// a concurrent-mode interruption, or a StrictMode development double-
// invocation) -- so a value recorded mid-render is not a reliable place to
// store "this job authoritatively completed." It also did not atomically
// couple the job id to the specific `results` array that job produced: the
// ref and the page's own `results` state were two independently-updated
// values that could, in principle, be inconsistent with each other in
// intermediate renders.
//
// Corrected architecture: the identity itself has moved out of this hook
// entirely and now lives in lib/screener/screenerJobStore.ts's own
// committed, `useSyncExternalStore`-backed state
// (`ScreenerJobState.lastResultsAffectingJobId`), set by
// completeScreenerJob() as part of the SAME atomic `emit()` call that
// transitions a job to 'complete' -- the exact same synchronous function
// body every results-affecting scan producer (runScreen/runPMCCScan/
// runCspScan/useRankedScan's real TaskManager-driven effect) already uses
// to call its own `setResults(...)`, with no `await` in between. Because
// `emit()` mutates the store's `currentState` synchronously (before
// `notify()` even runs), any render reading it via `useScreenerJobState()`
// is guaranteed to see the fully-updated value -- there is no possible
// intermediate render where `results` has advanced but this field has not,
// which is what actually makes the recommendations-fetch effect's job-id
// capture race-safe now (not the ref idiom round 3 relied on). See
// screenerJobStore.ts's own doc comments on `lastResultsAffectingJobId` and
// `completeScreenerJob()` for the full account, including why Targeted
// Scan stays structurally excluded and why a hard reload/cache-restore
// still starts and stays `null` until a real job completes this session.
//
// This hook is retained, unchanged in its call signature
// (`useLatestResultsAffectingJobId(screenerJob)`), purely as a documented,
// minimal-diff seam -- app/screener/page.tsx's own call site required no
// change across this correction. It performs no computation of its own
// now; it is a trivial, pure pass-through to the committed field
// screenerJobStore already derives correctly.

import type { ScreenerJobState } from '@/lib/screener/screenerJobStore';

/**
 * @param screenerJob The live `ScreenerJobState` (from `useScreenerJobState()`).
 *   Its own `lastResultsAffectingJobId` field is the full answer -- already
 *   committed, external-store state, already race-safe, already excluding
 *   Targeted Scan (see screenerJobStore.ts). This hook adds no logic of its
 *   own; it exists only as a stable, documented name for the seam.
 */
export function useLatestResultsAffectingJobId(screenerJob: ScreenerJobState): string | null {
  return screenerJob.lastResultsAffectingJobId;
}
