// lib/screener/__tests__/screenerJobStore.test.ts
//
// PO corrective round 4 (WA-0005 Defect 2): exhaustive coverage of
// screenerJobStore's `lastResultsAffectingJobId` field -- the committed,
// external-store-backed replacement for round 3's ref-mutated-during-render
// hook (lib/command-center/useLatestResultsAffectingJobId.ts, now a trivial
// pass-through -- see that module's own test file for the pass-through
// contract only).
//
// This is the real, exported, production screenerJobStore module -- the
// same startScreenerJob/completeScreenerJob/failScreenerJob/
// updateScreenerJob functions every results-affecting scan producer
// (runScreen/runPMCCScan/runCspScan/useRankedScan) already calls. Proves:
//   - completeScreenerJob() captures the completing job's own id into
//     lastResultsAffectingJobId, atomically, as part of the same emit()
//     that sets phase: 'complete' (no separate, later state update);
//   - it is NEVER cleared by a later job merely starting (startScreenerJob)
//     or failing (failScreenerJob) -- the exact defect round 3's ref-based
//     fix also targeted, now proven directly against the real store rather
//     than a hand-rolled hook;
//   - it advances forward, never backward, across successive completions;
//   - Targeted Scan completions are structurally excluded;
//   - it starts at null (the honest "no session job basis yet" / hard-
//     reload default) and clearScreenerJob() restores that default.

import { afterEach, describe, expect, it } from 'vitest';
import {
  clearScreenerJob,
  completeScreenerJob,
  failScreenerJob,
  getScreenerJobState,
  startScreenerJob,
  updateScreenerJob,
} from '../screenerJobStore';

afterEach(() => {
  // Module-level singleton (documented in the file itself) -- reset so no
  // test leaks a completed job's identity into the next one.
  clearScreenerJob();
});

describe('screenerJobStore: lastResultsAffectingJobId (PO round 4, committed-state fix)', () => {
  it('starts null -- the honest "no session job basis yet" / hard-reload default', () => {
    expect(getScreenerJobState().lastResultsAffectingJobId).toBeNull();
  });

  it('completeScreenerJob() captures the completing job\'s own id atomically, in the same update that sets phase: "complete"', () => {
    const id = startScreenerJob({ kind: 'rank', label: 'Ranked screener scan' });
    completeScreenerJob({ resultCount: 3 });

    const state = getScreenerJobState();
    expect(state.phase).toBe('complete');
    expect(state.lastResultsAffectingJobId).toBe(id);
  });

  it('does NOT clear when a subsequent job starts running (the exact defect this replaces)', () => {
    const idA = startScreenerJob({ kind: 'rank', label: 'Ranked screener scan' });
    completeScreenerJob({ resultCount: 3 });
    expect(getScreenerJobState().lastResultsAffectingJobId).toBe(idA);

    // A new scan starts -- the old inline derivation (screenerJob.phase ===
    // 'complete' ? screenerJob.id : null) would go null right here.
    startScreenerJob({ kind: 'rank', label: 'Ranked screener scan' });
    expect(getScreenerJobState().phase).toBe('running');
    expect(getScreenerJobState().lastResultsAffectingJobId).toBe(idA);
  });

  it('does NOT clear when the subsequent job fails', () => {
    const idA = startScreenerJob({ kind: 'rank', label: 'Ranked screener scan' });
    completeScreenerJob({ resultCount: 3 });

    startScreenerJob({ kind: 'rank', label: 'Ranked screener scan' });
    failScreenerJob('boom');

    expect(getScreenerJobState().phase).toBe('error');
    expect(getScreenerJobState().lastResultsAffectingJobId).toBe(idA);
  });

  it('does NOT clear when updateScreenerJob() patches progress mid-run', () => {
    const idA = startScreenerJob({ kind: 'rank', label: 'Ranked screener scan' });
    completeScreenerJob({ resultCount: 3 });

    startScreenerJob({ kind: 'rank', label: 'Ranked screener scan' });
    updateScreenerJob({ status: 'Scanning AAPL (1/5)...' });

    expect(getScreenerJobState().lastResultsAffectingJobId).toBe(idA);
  });

  it('advances forward (never backward) when the NEXT results-affecting job completes', () => {
    startScreenerJob({ kind: 'rank', label: 'Ranked screener scan' });
    completeScreenerJob({ resultCount: 3 });
    const idA = getScreenerJobState().lastResultsAffectingJobId;

    const idB = startScreenerJob({ kind: 'rank', label: 'Ranked screener scan' });
    completeScreenerJob({ resultCount: 5 });

    expect(getScreenerJobState().lastResultsAffectingJobId).toBe(idB);
    expect(getScreenerJobState().lastResultsAffectingJobId).not.toBe(idA);
  });

  it('excludes Targeted Scan completions entirely -- never captured, never supersedes a real results-affecting job', () => {
    const idA = startScreenerJob({ kind: 'rank', label: 'Ranked screener scan' });
    completeScreenerJob({ resultCount: 3 });
    expect(getScreenerJobState().lastResultsAffectingJobId).toBe(idA);

    startScreenerJob({ kind: 'targeted', label: 'Targeted screener scan' });
    completeScreenerJob({ resultCount: 9 });

    // Targeted Scan job IS now the live/current job (phase 'complete'), but
    // lastResultsAffectingJobId must still be idA -- Targeted Scan writes to
    // targetedResults, not results, and cannot affect the recommendations
    // pipeline.
    expect(getScreenerJobState().kind).toBe('targeted');
    expect(getScreenerJobState().lastResultsAffectingJobId).toBe(idA);
  });

  it('every non-targeted kind (filter/rank/pmcc/csp) is captured as results-affecting', () => {
    for (const kind of ['filter', 'rank', 'pmcc', 'csp'] as const) {
      clearScreenerJob();
      const id = startScreenerJob({ kind, label: `${kind} scan` });
      completeScreenerJob({ resultCount: 1 });
      expect(getScreenerJobState().lastResultsAffectingJobId).toBe(id);
    }
  });

  it('clearScreenerJob() restores the honest null default', () => {
    startScreenerJob({ kind: 'rank', label: 'Ranked screener scan' });
    completeScreenerJob({ resultCount: 3 });
    expect(getScreenerJobState().lastResultsAffectingJobId).not.toBeNull();

    clearScreenerJob();
    expect(getScreenerJobState().lastResultsAffectingJobId).toBeNull();
  });
});
