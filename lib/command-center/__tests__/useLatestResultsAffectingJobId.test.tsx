// lib/command-center/__tests__/useLatestResultsAffectingJobId.test.tsx
//
// PO corrective round 4 (WA-0005 Defect 2): the substantive "last completed
// results-affecting job" derivation logic has moved into
// lib/screener/screenerJobStore.ts's own completeScreenerJob() (committed,
// external-store state -- see
// lib/screener/__tests__/screenerJobStore.test.ts for exhaustive coverage
// of that derivation: capture-on-completion, never clearing on a later job
// running/failing, forward-only advancement, Targeted Scan exclusion, and
// the honest hard-reload-null default).
//
// This hook is now a trivial, pure pass-through
// (`screenerJob.lastResultsAffectingJobId`) -- retained only as a stable,
// documented seam so app/screener/page.tsx's call site needed no change.
// This file's only job is to prove that pass-through contract: whatever
// `screenerJob.lastResultsAffectingJobId` says, the hook returns exactly
// that, for any hand-constructed ScreenerJobState, with no additional
// computation, memoization drift, or stale-closure risk of its own.

import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLatestResultsAffectingJobId } from '../useLatestResultsAffectingJobId';
import type { ScreenerJobState } from '@/lib/screener/screenerJobStore';

function jobState(overrides: Partial<ScreenerJobState> = {}): ScreenerJobState {
  return {
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
    ...overrides,
  };
}

describe('useLatestResultsAffectingJobId (PO round 4: trivial pass-through to committed store state)', () => {
  it('returns null when the committed field is null, regardless of the live job phase', () => {
    const { result } = renderHook(({ job }) => useLatestResultsAffectingJobId(job), {
      initialProps: { job: jobState({ phase: 'running', kind: 'rank', id: 'job-a', lastResultsAffectingJobId: null }) },
    });
    expect(result.current).toBeNull();
  });

  it('returns exactly the committed field value the store already computed', () => {
    const { result } = renderHook(({ job }) => useLatestResultsAffectingJobId(job), {
      initialProps: { job: jobState({ phase: 'complete', kind: 'rank', id: 'job-a', lastResultsAffectingJobId: 'job-a' }) },
    });
    expect(result.current).toBe('job-a');
  });

  it('reflects the committed field even while the live job phase has moved on to running/error -- the store, not this hook, owns "never clears" now', () => {
    const { result, rerender } = renderHook(({ job }) => useLatestResultsAffectingJobId(job), {
      initialProps: { job: jobState({ phase: 'complete', kind: 'rank', id: 'job-a', lastResultsAffectingJobId: 'job-a' }) },
    });
    expect(result.current).toBe('job-a');

    // A later job is running/failing live, but the committed field the
    // store derived still correctly trails at 'job-a' -- this hook simply
    // reflects whatever the store says, proving it adds no logic (and no
    // staleness) of its own.
    rerender({ job: jobState({ phase: 'running', kind: 'rank', id: 'job-b', lastResultsAffectingJobId: 'job-a' }) });
    expect(result.current).toBe('job-a');

    rerender({ job: jobState({ phase: 'error', kind: 'rank', id: 'job-b', error: 'boom', lastResultsAffectingJobId: 'job-a' }) });
    expect(result.current).toBe('job-a');
  });

  it("advances the instant the committed field advances (the store's own forward-only update)", () => {
    const { result, rerender } = renderHook(({ job }) => useLatestResultsAffectingJobId(job), {
      initialProps: { job: jobState({ phase: 'complete', kind: 'rank', id: 'job-a', lastResultsAffectingJobId: 'job-a' }) },
    });
    expect(result.current).toBe('job-a');

    rerender({ job: jobState({ phase: 'complete', kind: 'rank', id: 'job-b', lastResultsAffectingJobId: 'job-b' }) });
    expect(result.current).toBe('job-b');
  });
});
