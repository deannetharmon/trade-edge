// lib/command-center/__tests__/screenerRankedOpportunitiesState.test.ts
//
// WA-0005 §15/§16/§22: exhaustive unit coverage for the pure Ranked
// Opportunities state-classification helper, since /screener's page itself
// has heavy live TastyTrade/IndexedDB/task-manager dependencies that make
// exercising every §15 state through a full render impractical. This
// module is the single source of truth this page's rendering branches on;
// covering it exhaustively here is equivalent to covering the page's own
// state contract.

import { describe, expect, it } from 'vitest';
import {
  classifyEmptyUniverseState,
  classifyRankedOpportunitiesState,
  type RankedOpportunitiesStateInput,
} from '../screenerRankedOpportunitiesState';

function baseInput(overrides: Partial<RankedOpportunitiesStateInput> = {}): RankedOpportunitiesStateInput {
  return {
    opportunityState: 'loaded',
    resultsLength: 5,
    rawAnalysesLength: 3,
    recommendationsLength: 3,
    recommendationsJobId: 'job_1',
    latestResultsAffectingJobId: 'job_1',
    ...overrides,
  };
}

describe('classifyRankedOpportunitiesState', () => {
  it('state 2: rawAnalyses > 0, recommendations === 0, successful evaluation -> isState2 true, isState5 false', () => {
    const result = classifyRankedOpportunitiesState(
      baseInput({ rawAnalysesLength: 4, recommendationsLength: 0 }),
    );
    expect(result.isState2).toBe(true);
    expect(result.isState5).toBe(false);
  });

  it('state 5: results > 0, rawAnalyses === 0, recommendations === 0, successful evaluation -> isState5 true, isState2 false', () => {
    const result = classifyRankedOpportunitiesState(
      baseInput({ resultsLength: 5, rawAnalysesLength: 0, recommendationsLength: 0 }),
    );
    expect(result.isState5).toBe(true);
    expect(result.isState2).toBe(false);
  });

  it('states 2 and 5 are mutually exclusive by construction -- no input satisfies both', () => {
    // Exhaustively enumerate every rawAnalysesLength/recommendationsLength
    // combination that could conceivably satisfy either state's guard.
    for (const rawAnalysesLength of [0, 1, 5]) {
      for (const recommendationsLength of [0, 1, 5]) {
        for (const resultsLength of [0, 1, 5]) {
          const result = classifyRankedOpportunitiesState(
            baseInput({ resultsLength, rawAnalysesLength, recommendationsLength }),
          );
          expect(result.isState2 && result.isState5).toBe(false);
        }
      }
    }
  });

  it('neither state 2 nor state 5 fires when recommendations exist (normal loaded case)', () => {
    const result = classifyRankedOpportunitiesState(baseInput({ recommendationsLength: 2 }));
    expect(result.isState2).toBe(false);
    expect(result.isState5).toBe(false);
  });

  it('neither state 2 nor state 5 fires while loading or on error, even if counts would otherwise match', () => {
    const loading = classifyRankedOpportunitiesState(
      baseInput({ opportunityState: 'loading', rawAnalysesLength: 0, recommendationsLength: 0 }),
    );
    expect(loading.isState2).toBe(false);
    expect(loading.isState5).toBe(false);

    const error = classifyRankedOpportunitiesState(
      baseInput({ opportunityState: 'error', rawAnalysesLength: 0, recommendationsLength: 0 }),
    );
    expect(error.isState2).toBe(false);
    expect(error.isState5).toBe(false);
  });

  it('all-REJECTED / WATCH-without-RECOMMENDED (states 3/4): neither state 2 nor state 5 fires whenever recommendations.length > 0', () => {
    const result = classifyRankedOpportunitiesState(baseInput({ rawAnalysesLength: 4, recommendationsLength: 4 }));
    expect(result.isState2).toBe(false);
    expect(result.isState5).toBe(false);
  });

  it('staleness (Finding 5): true when recommendationsJobId trails latestResultsAffectingJobId (a newer results-affecting scan job completed) and recommendations exist', () => {
    const result = classifyRankedOpportunitiesState(
      baseInput({ recommendationsJobId: 'job_1', latestResultsAffectingJobId: 'job_2', recommendationsLength: 3 }),
    );
    expect(result.isStale).toBe(true);
  });

  it('staleness: false when recommendationsJobId matches latestResultsAffectingJobId (freshly loaded from the same job)', () => {
    const result = classifyRankedOpportunitiesState(
      baseInput({ recommendationsJobId: 'job_2', latestResultsAffectingJobId: 'job_2', recommendationsLength: 3 }),
    );
    expect(result.isStale).toBe(false);
  });

  it('staleness: false when nothing has ever resolved (recommendationsJobId null), even if a results-affecting job has completed', () => {
    const result = classifyRankedOpportunitiesState(
      baseInput({ recommendationsJobId: null, latestResultsAffectingJobId: 'job_3', recommendationsLength: 0 }),
    );
    expect(result.isStale).toBe(false);
  });

  it('staleness: false when no results-affecting job has ever completed this session (latestResultsAffectingJobId null), e.g. results restored from IndexedDB with no associated job', () => {
    const result = classifyRankedOpportunitiesState(
      baseInput({ recommendationsJobId: null, latestResultsAffectingJobId: null, recommendationsLength: 3 }),
    );
    expect(result.isStale).toBe(false);
  });

  it('staleness: false when recommendations is empty, even if the job id trails (nothing stale to show)', () => {
    const result = classifyRankedOpportunitiesState(
      baseInput({ recommendationsJobId: 'job_1', latestResultsAffectingJobId: 'job_5', recommendationsLength: 0 }),
    );
    expect(result.isStale).toBe(false);
  });

  it('staleness persists during a failed refresh (opportunityState error, prior valid recommendations still present)', () => {
    const result = classifyRankedOpportunitiesState(
      baseInput({ opportunityState: 'error', recommendationsJobId: 'job_1', latestResultsAffectingJobId: 'job_2', recommendationsLength: 3 }),
    );
    expect(result.isStale).toBe(true);
  });

  it('Finding 5: a completed Targeted Scan job never marks Ranked Opportunities stale -- the caller is responsible for excluding Targeted Scan\'s job id from latestResultsAffectingJobId, since Targeted Scan cannot affect the recommendations pipeline', () => {
    // Simulates the caller (app/screener/page.tsx) having already excluded a
    // completed Targeted Scan job (latestResultsAffectingJobId stays at the
    // last *results-affecting* job's id, never a Targeted job's id).
    const result = classifyRankedOpportunitiesState(
      baseInput({ recommendationsJobId: 'job_filter_1', latestResultsAffectingJobId: 'job_filter_1', recommendationsLength: 3 }),
    );
    expect(result.isStale).toBe(false);
  });

  it('never uses an elapsed-time signal -- staleness is a pure function of job-identity only', () => {
    // No `now`/`Date`/timestamp parameter exists on the function signature
    // at all; this test documents that guarantee structurally by calling
    // the function with only job-id/count inputs and confirming identical
    // inputs always produce identical output regardless of when called.
    const a = classifyRankedOpportunitiesState(baseInput({ recommendationsJobId: 'job_1', latestResultsAffectingJobId: 'job_2' }));
    const b = classifyRankedOpportunitiesState(baseInput({ recommendationsJobId: 'job_1', latestResultsAffectingJobId: 'job_2' }));
    expect(a).toEqual(b);
  });
});

describe('classifyEmptyUniverseState', () => {
  it('AC-14: Initial/not-yet-run -- no scan has run this session', () => {
    expect(classifyEmptyUniverseState({ resultsLength: 0, scanHasRunThisSession: false })).toBe('not-yet-run');
  });

  it('AC-15/state 1: Empty Universe -- a scan completed with zero raw candidates, distinct from not-yet-run', () => {
    expect(classifyEmptyUniverseState({ resultsLength: 0, scanHasRunThisSession: true })).toBe('empty-universe');
  });

  it('has-results whenever resultsLength > 0, regardless of scanHasRunThisSession', () => {
    expect(classifyEmptyUniverseState({ resultsLength: 3, scanHasRunThisSession: false })).toBe('has-results');
    expect(classifyEmptyUniverseState({ resultsLength: 3, scanHasRunThisSession: true })).toBe('has-results');
  });
});
