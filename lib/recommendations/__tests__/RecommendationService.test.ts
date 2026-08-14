// lib/recommendations/__tests__/RecommendationService.test.ts
//
// CES-0001 (OE-0002B): coverage for the Recommendation Service. Confirms
// the acquisition boundary's contract end to end: an honest empty default
// with no publisher, that publishRecommendations() stores and announces
// exactly what it was given (no fabrication, no ranking, no filtering),
// that clearRecommendations() restores the honest empty state, and that
// subscribers are notified on every publish/clear. Does not re-test
// buildOpportunityRecommendations, the OE-0001 adapter, or the OE-0001
// ranker -- those already have their own passing test suites, unchanged.
//
// PO corrective round 4 (WA-0005 Defect 1): extended for the new
// `status`/`error` evaluation-lifecycle fields and the
// beginRecommendationsEvaluation()/failRecommendationsEvaluation() entry
// points -- proving a newer evaluation attempt's in-flight/failed status
// can be observed WITHOUT ever losing or fabricating the last successfully
// published `analyses`/`generatedAt`.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  beginRecommendationsEvaluation,
  clearRecommendations,
  failRecommendationsEvaluation,
  getCurrentRecommendations,
  publishRecommendations,
  subscribeToRecommendations,
} from '../RecommendationService';
import { buildDecisionAnalysisFixture } from '@/lib/opportunity-engine/__tests__/decisionAnalysisFixture';

afterEach(() => {
  // This module is a singleton (module-level state, by design -- see the
  // file's own doc comment on why it is not persisted). Reset between
  // tests so no test leaks published state into the next one.
  clearRecommendations();
});

describe('CES-0001: RecommendationService', () => {
  it('defaults to an honest empty state when nothing has been published yet', () => {
    expect(getCurrentRecommendations()).toEqual({ analyses: [], generatedAt: null, status: 'idle', error: null });
  });

  it('publishRecommendations stores exactly what it was given -- no fabrication, no ranking, no filtering', () => {
    const analyses = [
      buildDecisionAnalysisFixture({ symbol: 'AAPL' }),
      buildDecisionAnalysisFixture({ symbol: 'SPY' }),
    ];

    publishRecommendations(analyses, '2026-07-24T15:00:00.000Z');

    const current = getCurrentRecommendations();
    expect(current.analyses).toBe(analyses);
    expect(current.generatedAt).toBe('2026-07-24T15:00:00.000Z');
  });

  it('publishRecommendations defaults generatedAt to now when the caller omits it', () => {
    const before = Date.now();
    publishRecommendations([buildDecisionAnalysisFixture({ symbol: 'AAPL' })]);
    const after = Date.now();

    const current = getCurrentRecommendations();
    expect(current.generatedAt).not.toBeNull();
    const generatedAtMs = new Date(current.generatedAt as string).getTime();
    expect(generatedAtMs).toBeGreaterThanOrEqual(before);
    expect(generatedAtMs).toBeLessThanOrEqual(after);
  });

  it('clearRecommendations restores the honest empty state after a publish', () => {
    publishRecommendations([buildDecisionAnalysisFixture({ symbol: 'AAPL' })], '2026-07-24T15:00:00.000Z');
    clearRecommendations();

    expect(getCurrentRecommendations()).toEqual({ analyses: [], generatedAt: null, status: 'idle', error: null });
  });

  it('notifies subscribers on publish and on clear', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToRecommendations(listener);

    publishRecommendations([buildDecisionAnalysisFixture({ symbol: 'AAPL' })]);
    expect(listener).toHaveBeenCalledTimes(1);

    clearRecommendations();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  it('stops notifying a subscriber once unsubscribed', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToRecommendations(listener);
    unsubscribe();

    publishRecommendations([buildDecisionAnalysisFixture({ symbol: 'AAPL' })]);

    expect(listener).not.toHaveBeenCalled();
  });

  it('a second publish overwrites the first rather than merging with it', () => {
    publishRecommendations([buildDecisionAnalysisFixture({ symbol: 'AAPL' })], '2026-07-24T15:00:00.000Z');
    publishRecommendations([buildDecisionAnalysisFixture({ symbol: 'SPY' })], '2026-07-24T16:00:00.000Z');

    const current = getCurrentRecommendations();
    expect(current.analyses).toHaveLength(1);
    expect(current.analyses[0].subject.symbol).toBe('SPY');
    expect(current.generatedAt).toBe('2026-07-24T16:00:00.000Z');
  });

  it('publishRecommendations always resets status to "idle" and error to null -- a successful publish IS the most recent attempt\'s outcome', () => {
    failRecommendationsEvaluation('boom');
    expect(getCurrentRecommendations().status).toBe('error');

    publishRecommendations([buildDecisionAnalysisFixture({ symbol: 'AAPL' })], '2026-07-24T15:00:00.000Z');

    const current = getCurrentRecommendations();
    expect(current.status).toBe('idle');
    expect(current.error).toBeNull();
  });
});

describe('PO corrective round 4 (WA-0005 Defect 1): evaluation-lifecycle status', () => {
  it('beginRecommendationsEvaluation sets status "loading" WITHOUT touching the last successfully published analyses/generatedAt', () => {
    const analyses = [buildDecisionAnalysisFixture({ symbol: 'AAPL' })];
    publishRecommendations(analyses, '2026-07-24T15:00:00.000Z');

    beginRecommendationsEvaluation();

    const current = getCurrentRecommendations();
    expect(current.status).toBe('loading');
    expect(current.error).toBeNull();
    // The prior valid published set remains untouched underneath the new
    // in-flight status -- never cleared just because a newer attempt started.
    expect(current.analyses).toBe(analyses);
    expect(current.generatedAt).toBe('2026-07-24T15:00:00.000Z');
  });

  it('failRecommendationsEvaluation sets status "error" and records the message WITHOUT clearing the last successfully published analyses/generatedAt', () => {
    const analyses = [buildDecisionAnalysisFixture({ symbol: 'AAPL' })];
    publishRecommendations(analyses, '2026-07-24T15:00:00.000Z');

    beginRecommendationsEvaluation();
    failRecommendationsEvaluation('Recommendation engine unavailable.');

    const current = getCurrentRecommendations();
    expect(current.status).toBe('error');
    expect(current.error).toBe('Recommendation engine unavailable.');
    // A failed refresh must never blank out a previously-valid result.
    expect(current.analyses).toBe(analyses);
    expect(current.generatedAt).toBe('2026-07-24T15:00:00.000Z');
  });

  it('beginRecommendationsEvaluation clears a PRIOR error -- a fresh attempt supersedes the outcome of the one before it until it itself resolves', () => {
    failRecommendationsEvaluation('old failure');
    expect(getCurrentRecommendations().status).toBe('error');

    beginRecommendationsEvaluation();

    const current = getCurrentRecommendations();
    expect(current.status).toBe('loading');
    expect(current.error).toBeNull();
  });

  it('the empty default status is "idle" with a null error, and clearRecommendations() restores exactly that after a loading/error transition', () => {
    beginRecommendationsEvaluation();
    failRecommendationsEvaluation('boom');
    clearRecommendations();

    expect(getCurrentRecommendations()).toEqual({ analyses: [], generatedAt: null, status: 'idle', error: null });
  });

  it('notifies subscribers on beginRecommendationsEvaluation and failRecommendationsEvaluation, same as publish/clear', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToRecommendations(listener);

    beginRecommendationsEvaluation();
    expect(listener).toHaveBeenCalledTimes(1);

    failRecommendationsEvaluation('boom');
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
  });
});
