// lib/decision-review/__tests__/decisionReview.test.ts
//
// PI-0008C: Decision Outcome Tracking V1 -- pure logic tests.
// PI-0008D: Decision Review Follow-Up Reminder -- see the tests near the
// bottom of this file for reviewsNeedingFollowUp()/isReviewNeedingFollowUp().

import { describe, expect, it } from 'vitest';
import type { PortfolioRecommendation } from '@/lib/portfolio-intelligence';
import {
  buildEvidenceSnapshot,
  createDecisionReview,
  updateDecisionReview,
  parseDecisionReviewStore,
  upsertDecisionReview,
  latestReviewForPosition,
  allReviewsByRecency,
  filterDecisionReviews,
  reviewsNeedingFollowUp,
  isReviewNeedingFollowUp,
} from '../decisionReview';
import type { DecisionReview, DecisionReviewStore } from '../types';

const NOW = new Date('2026-07-20T12:00:00.000Z');

function makeRecommendation(overrides: Partial<PortfolioRecommendation> = {}): PortfolioRecommendation {
  return {
    positionId: 'pos_1',
    symbol: 'SOXL',
    kind: 'close-loser',
    label: 'Cut Losses',
    urgency: 'critical',
    confidence: 91,
    primaryReason: 'Loss is near or beyond 1x credit.',
    supportingReasons: ['Days to expiration: 17.', 'Open P/L: -105% of credit.'],
    suggestedAction: 'Review closing or rolling defensively.',
    computedAt: NOW.toISOString(),
    managementIntent: {
      intent: 'CUT_LOSSES',
      label: 'Cut Losses',
      reasons: ['Loss has reached the policy loss-stop threshold.'],
      alternatives: [],
      candidates: [],
      winnerScore: 196,
      runnerUpIntent: 'REDUCE_RISK',
      runnerUpScore: 181,
      margin: 15,
      confidenceTier: 'Medium',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Creating a review
// ---------------------------------------------------------------------------

describe('createDecisionReview', () => {
  it('builds a complete review with sensible defaults for a brand-new position', () => {
    const review = createDecisionReview(
      { positionId: 'pos_1', symbol: 'SOXL', strategy: 'BPS', recommendation: makeRecommendation() },
      NOW,
    );
    expect(review.id).toMatch(/^review_/);
    expect(review.positionId).toBe('pos_1');
    expect(review.symbol).toBe('SOXL');
    expect(review.strategy).toBe('BPS');
    expect(review.traderAction).toBeNull();
    expect(review.traderActionAt).toBeNull();
    expect(review.outcomeStatus).toBe('PENDING');
    expect(review.realizedPnl).toBeNull();
    expect(review.notes).toBe('');
    expect(review.createdAt).toBe(NOW.toISOString());
    expect(review.updatedAt).toBe(NOW.toISOString());
  });

  it('generates a unique id on every call', () => {
    const a = createDecisionReview({ positionId: 'p', symbol: 'A', strategy: 'BPS', recommendation: makeRecommendation() }, NOW);
    const b = createDecisionReview({ positionId: 'p', symbol: 'A', strategy: 'BPS', recommendation: makeRecommendation() }, NOW);
    expect(a.id).not.toBe(b.id);
  });

  it('snapshots the recommendation evidence at creation time', () => {
    const review = createDecisionReview(
      { positionId: 'pos_1', symbol: 'SOXL', strategy: 'BPS', recommendation: makeRecommendation() },
      NOW,
    );
    expect(review.evidence).toEqual({
      managementIntent: 'CUT_LOSSES',
      label: 'Cut Losses',
      primaryReason: 'Loss is near or beyond 1x credit.',
      reasons: ['Loss has reached the policy loss-stop threshold.'],
      confidence: 91,
      winnerScore: 196,
      runnerUpIntent: 'REDUCE_RISK',
      runnerUpScore: 181,
      margin: 15,
      confidenceTier: 'Medium',
    });
  });

  it('falls back gracefully when managementIntent is absent from the recommendation', () => {
    const review = createDecisionReview(
      { positionId: 'pos_1', symbol: 'SOXL', strategy: 'BPS', recommendation: makeRecommendation({ managementIntent: undefined }) },
      NOW,
    );
    expect(review.evidence.managementIntent).toBe('close-loser'); // falls back to legacy `kind`
    expect(review.evidence.winnerScore).toBeNull();
    expect(review.evidence.runnerUpIntent).toBeNull();
    expect(review.evidence.confidenceTier).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Missing optional fields (P/L, notes)
// ---------------------------------------------------------------------------

describe('createDecisionReview: missing optional P/L and notes', () => {
  it('defaults realizedPnl to null and notes to an empty string when omitted', () => {
    const review = createDecisionReview(
      { positionId: 'pos_1', symbol: 'SOXL', strategy: 'BPS', recommendation: makeRecommendation() },
      NOW,
    );
    expect(review.realizedPnl).toBeNull();
    expect(review.notes).toBe('');
  });

  it('accepts explicit realizedPnl and notes when provided', () => {
    const review = createDecisionReview(
      {
        positionId: 'pos_1', symbol: 'SOXL', strategy: 'BPS', recommendation: makeRecommendation(),
        realizedPnl: -340.5, notes: 'Closed early on earnings risk.',
      },
      NOW,
    );
    expect(review.realizedPnl).toBe(-340.5);
    expect(review.notes).toBe('Closed early on earnings risk.');
  });
});

// ---------------------------------------------------------------------------
// Editing a review
// ---------------------------------------------------------------------------

describe('updateDecisionReview', () => {
  const original = createDecisionReview(
    { positionId: 'pos_1', symbol: 'SOXL', strategy: 'BPS', recommendation: makeRecommendation() },
    NOW,
  );

  it('updates only the trader-editable fields and bumps updatedAt', () => {
    const later = new Date('2026-07-21T09:00:00.000Z');
    const edited = updateDecisionReview(
      original,
      { traderAction: 'CUT_LOSSES', outcomeStatus: 'FAVORABLE', realizedPnl: -280, notes: 'Closed at a smaller loss than modeled.' },
      later,
    );
    expect(edited.traderAction).toBe('CUT_LOSSES');
    expect(edited.traderActionAt).toBe(later.toISOString());
    expect(edited.outcomeStatus).toBe('FAVORABLE');
    expect(edited.realizedPnl).toBe(-280);
    expect(edited.notes).toBe('Closed at a smaller loss than modeled.');
    expect(edited.updatedAt).toBe(later.toISOString());
  });

  it('preserves identity and snapshot fields exactly', () => {
    const later = new Date('2026-07-21T09:00:00.000Z');
    const edited = updateDecisionReview(original, { outcomeStatus: 'UNFAVORABLE' }, later);
    expect(edited.id).toBe(original.id);
    expect(edited.positionId).toBe(original.positionId);
    expect(edited.symbol).toBe(original.symbol);
    expect(edited.strategy).toBe(original.strategy);
    expect(edited.recommendedAt).toBe(original.recommendedAt);
    expect(edited.evidence).toEqual(original.evidence);
    expect(edited.createdAt).toBe(original.createdAt);
  });

  it('leaves traderActionAt untouched when the patch does not include traderAction', () => {
    const withAction = updateDecisionReview(original, { traderAction: 'HELD_POSITION' }, new Date('2026-07-21T09:00:00.000Z'));
    const later = updateDecisionReview(withAction, { notes: 'Still holding.' }, new Date('2026-07-22T09:00:00.000Z'));
    expect(later.traderAction).toBe('HELD_POSITION');
    expect(later.traderActionAt).toBe(withAction.traderActionAt);
  });

  it('allows clearing realizedPnl back to null explicitly', () => {
    const withPnl = updateDecisionReview(original, { realizedPnl: 120 }, NOW);
    const cleared = updateDecisionReview(withPnl, { realizedPnl: null }, NOW);
    expect(cleared.realizedPnl).toBeNull();
  });

  it('is a pure function: does not mutate the original review object', () => {
    const before = JSON.parse(JSON.stringify(original));
    updateDecisionReview(original, { outcomeStatus: 'NEUTRAL', notes: 'changed' }, new Date());
    expect(original).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Snapshot integrity: the original recommendation snapshot is unaffected by
// a later change to the live recommendation for the same position.
// ---------------------------------------------------------------------------

describe('Snapshot integrity (ticket #7)', () => {
  it('a review created from one recommendation keeps its evidence even after the live recommendation changes', () => {
    const review = createDecisionReview(
      { positionId: 'pos_1', symbol: 'SOXL', strategy: 'BPS', recommendation: makeRecommendation() },
      NOW,
    );

    // The live recommendation for this same position later changes entirely
    // (e.g. the position recovered and now reads Hold Position) -- this
    // must never be re-derived into the existing review.
    const laterLiveRecommendation = makeRecommendation({
      label: 'Hold Position',
      primaryReason: 'No primary action rule triggered.',
      managementIntent: {
        intent: 'HOLD_POSITION',
        label: 'Hold Position',
        reasons: [],
        alternatives: [],
        candidates: [],
        winnerScore: 10,
        runnerUpIntent: null,
        runnerUpScore: 0,
        margin: 10,
        confidenceTier: 'Low',
      },
    });

    // Editing the review (e.g. just adding a note) never re-snapshots.
    const edited = updateDecisionReview(review, { notes: 'Checking back in.' }, NOW);
    expect(edited.evidence.managementIntent).toBe('CUT_LOSSES');
    expect(edited.evidence.label).toBe('Cut Losses');
    expect(edited.evidence).toEqual(review.evidence);

    // And building a fresh snapshot from the new live recommendation is a
    // genuinely different, independent value -- proving the old one wasn't
    // silently derived from a live reference.
    const freshSnapshot = buildEvidenceSnapshot(laterLiveRecommendation);
    expect(freshSnapshot.managementIntent).toBe('HOLD_POSITION');
    expect(review.evidence.managementIntent).toBe('CUT_LOSSES');
  });
});

// ---------------------------------------------------------------------------
// Persistence across reload -- round-trip through the exact serialization
// the Redis-backed API route uses (JSON.stringify / parseDecisionReviewStore).
// ---------------------------------------------------------------------------

describe('persistence across reload', () => {
  it('round-trips a store through JSON serialization unchanged', () => {
    const review = createDecisionReview(
      { positionId: 'pos_1', symbol: 'SOXL', strategy: 'BPS', recommendation: makeRecommendation(), notes: 'note', realizedPnl: -50 },
      NOW,
    );
    const store: DecisionReviewStore = upsertDecisionReview({}, review);
    const raw = JSON.stringify(store);
    const reloaded = parseDecisionReviewStore(raw);
    expect(reloaded).toEqual(store);
  });

  it('reflects an edit after a simulated reload', () => {
    const review = createDecisionReview(
      { positionId: 'pos_1', symbol: 'SOXL', strategy: 'BPS', recommendation: makeRecommendation() },
      NOW,
    );
    const stored = JSON.stringify(upsertDecisionReview({}, review));
    const reloaded = parseDecisionReviewStore(stored);
    const edited = updateDecisionReview(reloaded[review.id], { outcomeStatus: 'FAVORABLE' }, new Date('2026-07-22T00:00:00.000Z'));
    const restoredAfterSecondReload = parseDecisionReviewStore(JSON.stringify(upsertDecisionReview(reloaded, edited)));
    expect(restoredAfterSecondReload[review.id].outcomeStatus).toBe('FAVORABLE');
    expect(restoredAfterSecondReload[review.id].evidence).toEqual(review.evidence);
  });
});

// ---------------------------------------------------------------------------
// Corrupt persisted data handling
// ---------------------------------------------------------------------------

describe('parseDecisionReviewStore: corrupt data handling', () => {
  it('returns an empty store for null/undefined input', () => {
    expect(parseDecisionReviewStore(null)).toEqual({});
    expect(parseDecisionReviewStore(undefined)).toEqual({});
    expect(parseDecisionReviewStore('')).toEqual({});
  });

  it('returns an empty store for invalid JSON', () => {
    expect(parseDecisionReviewStore('{not valid json')).toEqual({});
  });

  it('returns an empty store when the parsed JSON is not an object', () => {
    expect(parseDecisionReviewStore('[]')).toEqual({});
    expect(parseDecisionReviewStore('"a string"')).toEqual({});
    expect(parseDecisionReviewStore('42')).toEqual({});
    expect(parseDecisionReviewStore('null')).toEqual({});
  });

  it('drops individual malformed entries while keeping valid ones', () => {
    const review = createDecisionReview(
      { positionId: 'pos_1', symbol: 'SOXL', strategy: 'BPS', recommendation: makeRecommendation() },
      NOW,
    );
    const raw = JSON.stringify({
      [review.id]: review,
      'broken-1': { id: 'broken-1' }, // missing required fields
      'broken-2': 'not even an object',
      'broken-3': null,
    });
    const result = parseDecisionReviewStore(raw);
    expect(Object.keys(result)).toEqual([review.id]);
    expect(result[review.id]).toEqual(review);
  });
});

// ---------------------------------------------------------------------------
// latestReviewForPosition / allReviewsByRecency
// ---------------------------------------------------------------------------

describe('latestReviewForPosition', () => {
  it('returns null when no review exists for the position', () => {
    expect(latestReviewForPosition({}, 'pos_1')).toBeNull();
  });

  it('returns the most recently updated review among several for the same position', () => {
    const first = createDecisionReview({ positionId: 'pos_1', symbol: 'SOXL', strategy: 'BPS', recommendation: makeRecommendation() }, new Date('2026-07-01T00:00:00.000Z'));
    const second = createDecisionReview({ positionId: 'pos_1', symbol: 'SOXL', strategy: 'BPS', recommendation: makeRecommendation() }, new Date('2026-07-10T00:00:00.000Z'));
    const store = upsertDecisionReview(upsertDecisionReview({}, first), second);
    expect(latestReviewForPosition(store, 'pos_1')?.id).toBe(second.id);
  });
});

// ---------------------------------------------------------------------------
// Filtering decision history (ticket #6)
// ---------------------------------------------------------------------------

describe('filterDecisionReviews', () => {
  function review(overrides: Partial<DecisionReview>): DecisionReview {
    const base = createDecisionReview(
      { positionId: overrides.positionId ?? 'pos_x', symbol: 'X', strategy: 'BPS', recommendation: makeRecommendation() },
      NOW,
    );
    return { ...base, ...overrides };
  }

  const reviews: DecisionReview[] = [
    review({ id: 'r1', outcomeStatus: 'PENDING', traderAction: null }),
    review({ id: 'r2', outcomeStatus: 'FAVORABLE', traderAction: 'FOLLOWED_RECOMMENDATION' }),
    review({ id: 'r3', outcomeStatus: 'UNFAVORABLE', traderAction: 'HELD_POSITION' }),
    review({ id: 'r4', outcomeStatus: 'NEUTRAL', traderAction: 'FOLLOWED_RECOMMENDATION' }),
    review({ id: 'r5', outcomeStatus: 'PENDING', traderAction: 'OTHER' }),
  ];

  it('ALL returns every review unfiltered', () => {
    expect(filterDecisionReviews(reviews, 'ALL')).toHaveLength(5);
  });

  it('PENDING returns only pending-outcome reviews', () => {
    expect(filterDecisionReviews(reviews, 'PENDING').map((r) => r.id)).toEqual(['r1', 'r5']);
  });

  it('FAVORABLE returns only favorable-outcome reviews', () => {
    expect(filterDecisionReviews(reviews, 'FAVORABLE').map((r) => r.id)).toEqual(['r2']);
  });

  it('UNFAVORABLE returns only unfavorable-outcome reviews', () => {
    expect(filterDecisionReviews(reviews, 'UNFAVORABLE').map((r) => r.id)).toEqual(['r3']);
  });

  it('FOLLOWED returns only reviews explicitly logged as Followed Recommendation', () => {
    expect(filterDecisionReviews(reviews, 'FOLLOWED').map((r) => r.id)).toEqual(['r2', 'r4']);
  });

  it('NOT_FOLLOWED returns reviews with a logged action other than Followed Recommendation, excluding un-logged ones', () => {
    expect(filterDecisionReviews(reviews, 'NOT_FOLLOWED').map((r) => r.id)).toEqual(['r3', 'r5']);
  });

  it('NEEDS_FOLLOW_UP returns only Pending reviews whose position is not in the open set', () => {
    const mixed: DecisionReview[] = [
      review({ id: 'f1', positionId: 'pos_open', outcomeStatus: 'PENDING' }),
      review({ id: 'f2', positionId: 'pos_closed', outcomeStatus: 'PENDING' }),
      review({ id: 'f3', positionId: 'pos_closed_but_done', outcomeStatus: 'FAVORABLE' }),
    ];
    expect(filterDecisionReviews(mixed, 'NEEDS_FOLLOW_UP', ['pos_open']).map((r) => r.id)).toEqual(['f2']);
  });

  it('NEEDS_FOLLOW_UP treats every Pending review as needing follow-up when no open-position set is supplied', () => {
    expect(filterDecisionReviews(reviews, 'NEEDS_FOLLOW_UP').map((r) => r.id)).toEqual(['r1', 'r5']);
  });
});

// ---------------------------------------------------------------------------
// PI-0008D: Decision Review Follow-Up Reminder
// ---------------------------------------------------------------------------

describe('reviewsNeedingFollowUp', () => {
  function review(positionId: string, outcomeStatus: DecisionReview['outcomeStatus'], id: string): DecisionReview {
    const base = createDecisionReview(
      { positionId, symbol: 'X', strategy: 'BPS', recommendation: makeRecommendation() },
      NOW,
    );
    return { ...base, id, outcomeStatus };
  }

  it('does not flag a pending review whose position is still open', () => {
    const store: DecisionReviewStore = upsertDecisionReview({}, review('pos_open', 'PENDING', 'r1'));
    expect(reviewsNeedingFollowUp(store, ['pos_open'])).toEqual([]);
    expect(isReviewNeedingFollowUp(store['r1'], ['pos_open'])).toBe(false);
  });

  it('flags a pending review whose position is closed/missing from the open set', () => {
    const r = review('pos_closed', 'PENDING', 'r1');
    const store: DecisionReviewStore = upsertDecisionReview({}, r);
    expect(reviewsNeedingFollowUp(store, ['pos_open']).map((x) => x.id)).toEqual(['r1']);
    expect(isReviewNeedingFollowUp(r, ['pos_open'])).toBe(true);
  });

  it('never flags a completed (non-Pending) review, regardless of open-position state', () => {
    const favorable = review('pos_closed', 'FAVORABLE', 'r1');
    const unfavorable = review('pos_closed', 'UNFAVORABLE', 'r2');
    const neutral = review('pos_closed', 'NEUTRAL', 'r3');
    const insufficient = review('pos_closed', 'INSUFFICIENT_DATA', 'r4');
    const store: DecisionReviewStore = [favorable, unfavorable, neutral, insufficient].reduce(upsertDecisionReview, {});
    expect(reviewsNeedingFollowUp(store, [])).toEqual([]);
    for (const r of [favorable, unfavorable, neutral, insufficient]) {
      expect(isReviewNeedingFollowUp(r, [])).toBe(false);
    }
  });

  it('accepts a Set as well as an array for openPositionIds', () => {
    const r = review('pos_closed', 'PENDING', 'r1');
    const store: DecisionReviewStore = upsertDecisionReview({}, r);
    expect(reviewsNeedingFollowUp(store, new Set(['pos_open']))).toHaveLength(1);
    expect(reviewsNeedingFollowUp(store, new Set(['pos_closed']))).toHaveLength(0);
  });

  it('returns an empty array for an empty store', () => {
    expect(reviewsNeedingFollowUp({}, ['pos_open'])).toEqual([]);
  });

  it('returns an empty array when every pending position is still open', () => {
    const store: DecisionReviewStore = [
      review('pos_a', 'PENDING', 'r1'),
      review('pos_b', 'PENDING', 'r2'),
    ].reduce(upsertDecisionReview, {});
    expect(reviewsNeedingFollowUp(store, ['pos_a', 'pos_b'])).toEqual([]);
  });
});

describe('allReviewsByRecency', () => {
  it('sorts newest-updated first', () => {
    const older = createDecisionReview({ positionId: 'pos_1', symbol: 'A', strategy: 'BPS', recommendation: makeRecommendation() }, new Date('2026-07-01T00:00:00.000Z'));
    const newer = createDecisionReview({ positionId: 'pos_2', symbol: 'B', strategy: 'BPS', recommendation: makeRecommendation() }, new Date('2026-07-15T00:00:00.000Z'));
    const store = upsertDecisionReview(upsertDecisionReview({}, older), newer);
    expect(allReviewsByRecency(store).map((r) => r.id)).toEqual([newer.id, older.id]);
  });
});
