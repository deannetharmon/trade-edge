// lib/decision-review/__tests__/outcomeAnalysis.test.ts
//
// PI-0009B: Decision Outcome Analysis, V1 -- targeted tests for matching a
// Decision Review to a Closed Trade via the Position Snapshot bridge, and
// for the CORRECT/INCORRECT/INCONCLUSIVE accuracy truth table.

import { describe, expect, it } from 'vitest';
import { analyzeDecisionOutcome, findClosedTradeForReview } from '../outcomeAnalysis';
import type { DecisionReview } from '../types';
import type { PositionSnapshotStore, PositionLifecycleSnapshot } from '@/lib/position-snapshot';
import type { ClosedTrade } from '@/lib/tradeLog/reconstructTrades';

function makeReview(overrides: Partial<DecisionReview> = {}): DecisionReview {
  return {
    id: 'r1',
    positionId: 'pos_1',
    symbol: 'SOXL',
    strategy: 'BPS',
    recommendedAt: '2026-06-01T00:00:00.000Z',
    evidence: {
      managementIntent: 'CUT_LOSSES',
      label: 'Cut Losses',
      primaryReason: 'Buffer eroded past threshold',
      reasons: [],
      confidence: 82,
      winnerScore: null,
      runnerUpIntent: null,
      runnerUpScore: null,
      margin: null,
      confidenceTier: null,
    },
    traderAction: null,
    traderActionAt: null,
    outcomeStatus: 'PENDING',
    realizedPnl: null,
    notes: '',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeCloseSnapshot(overrides: Partial<PositionLifecycleSnapshot> = {}): PositionLifecycleSnapshot {
  return {
    id: 'psnap_1',
    positionKey: 'pos_1',
    event: 'POSITION_CLOSE',
    capturedAt: '2026-06-10T00:00:00.000Z',
    symbol: 'SOXL',
    strategy: 'BPS',
    dte: 5,
    creditReceived: 200,
    closeValue: 20,
    delta: -0.2,
    pop: 65,
    netEdge: -3,
    healthScore: 40,
    remainingOpportunityPct: 10,
    recommendation: 'Cut Losses',
    confidence: 82,
    keyEvidence: ['Buffer eroded past threshold'],
    earningsStatus: 'NONE',
    earningsDate: null,
    ...overrides,
  };
}

function makeClosedTrade(overrides: Partial<ClosedTrade> = {}): ClosedTrade {
  return {
    id: 'SOXL-2026-05-15-2026-07-17-2026-06-10',
    symbol: 'SOXL',
    strategy: 'BPS',
    openDate: '2026-05-15',
    closeDate: '2026-06-10',
    openTime: '10:00',
    openDow: 3,
    expiry: '2026-07-17',
    holdDays: 26,
    strikes: '20P/18P',
    creditReceived: 200,
    closePrice: 350,
    pnl: -150,
    pnlPct: -75,
    outcome: 'LOSS',
    quantity: 2,
    fees: 2,
    dteAtClose: 37,
    dteAtEntry: 63,
    exitType: 'MANAGED_LOSS',
    reconstructionStatus: 'COMPLETE',
    closureMechanism: 'CLOSED',
    openedQuantity: 1,
    closedQuantity: 1,
    remainingQuantity: 0,
    sourceTransactionIds: ['o1', 'c1'],
    ...overrides,
  };
}

describe('findClosedTradeForReview: matching', () => {
  it('returns null when the position has no snapshot history at all', () => {
    const review = makeReview();
    expect(findClosedTradeForReview(review, {}, [makeClosedTrade()])).toBeNull();
  });

  it('returns null when the position has history but no POSITION_CLOSE event yet', () => {
    const review = makeReview();
    const store: PositionSnapshotStore = { pos_1: [makeCloseSnapshot({ event: 'POSITION_DETECTED' })] };
    expect(findClosedTradeForReview(review, store, [makeClosedTrade()])).toBeNull();
  });

  it('returns null when no closed trade matches the symbol', () => {
    const review = makeReview();
    const store: PositionSnapshotStore = { pos_1: [makeCloseSnapshot()] };
    const trades = [makeClosedTrade({ symbol: 'AMD' })];
    expect(findClosedTradeForReview(review, store, trades)).toBeNull();
  });

  it('returns null when the closest same-symbol trade closed far outside the match window', () => {
    const review = makeReview();
    const store: PositionSnapshotStore = { pos_1: [makeCloseSnapshot({ capturedAt: '2026-06-10T00:00:00.000Z' })] };
    const trades = [makeClosedTrade({ closeDate: '2026-01-01' })]; // ~5 months away
    expect(findClosedTradeForReview(review, store, trades)).toBeNull();
  });

  it('picks the same-symbol trade whose closeDate is closest to the close snapshot capturedAt', () => {
    const review = makeReview();
    const store: PositionSnapshotStore = { pos_1: [makeCloseSnapshot({ capturedAt: '2026-06-10T00:00:00.000Z' })] };
    const near = makeClosedTrade({ id: 'near', closeDate: '2026-06-11' });
    const far = makeClosedTrade({ id: 'far', closeDate: '2026-05-01' });
    const trades = [far, near];
    expect(findClosedTradeForReview(review, store, trades)?.id).toBe('near');
  });
});

describe('analyzeDecisionOutcome: accuracy truth table', () => {
  const store: PositionSnapshotStore = { pos_1: [makeCloseSnapshot()] };

  it('returns null (insufficient data) when there is no match', () => {
    expect(analyzeDecisionOutcome(makeReview(), {}, [makeClosedTrade()])).toBeNull();
  });

  it('followed + favorable outcome => CORRECT', () => {
    const review = makeReview({ traderAction: 'FOLLOWED_RECOMMENDATION' });
    const trade = makeClosedTrade({ outcome: 'WIN', pnl: 150 });
    const result = analyzeDecisionOutcome(review, store, [trade]);
    expect(result?.traderOutcome).toBe('FAVORABLE');
    expect(result?.recommendationOutcome).toBe('FAVORABLE');
    expect(result?.recommendationAccuracy).toBe('CORRECT');
    expect(result?.realizedPnl).toBe(150);
  });

  it('followed + unfavorable outcome => INCORRECT', () => {
    const review = makeReview({ traderAction: 'FOLLOWED_RECOMMENDATION' });
    const trade = makeClosedTrade({ outcome: 'LOSS', pnl: -150 });
    const result = analyzeDecisionOutcome(review, store, [trade]);
    expect(result?.recommendationOutcome).toBe('UNFAVORABLE');
    expect(result?.recommendationAccuracy).toBe('INCORRECT');
  });

  it('did not follow + unfavorable outcome => CORRECT (ignoring the advice cost them)', () => {
    const review = makeReview({ traderAction: 'HELD_POSITION' });
    const trade = makeClosedTrade({ outcome: 'LOSS', pnl: -400 });
    const result = analyzeDecisionOutcome(review, store, [trade]);
    expect(result?.traderOutcome).toBe('UNFAVORABLE');
    expect(result?.recommendationOutcome).toBe('FAVORABLE'); // the untaken path, validated in hindsight
    expect(result?.recommendationAccuracy).toBe('CORRECT');
  });

  it('did not follow + favorable outcome => INCORRECT (ignoring the advice worked out)', () => {
    const review = makeReview({ traderAction: 'HELD_POSITION' });
    const trade = makeClosedTrade({ outcome: 'WIN', pnl: 80 });
    const result = analyzeDecisionOutcome(review, store, [trade]);
    expect(result?.recommendationOutcome).toBe('UNFAVORABLE');
    expect(result?.recommendationAccuracy).toBe('INCORRECT');
  });

  it('scratch outcome => INCONCLUSIVE regardless of trader action', () => {
    const review = makeReview({ traderAction: 'FOLLOWED_RECOMMENDATION' });
    const trade = makeClosedTrade({ outcome: 'SCRATCH', pnl: 3 });
    const result = analyzeDecisionOutcome(review, store, [trade]);
    expect(result?.traderOutcome).toBe('NEUTRAL');
    expect(result?.recommendationOutcome).toBe('NEUTRAL');
    expect(result?.recommendationAccuracy).toBe('INCONCLUSIVE');
  });

  it('unknown trader action => real traderOutcome reported, but accuracy is INCONCLUSIVE and recommendationOutcome is null', () => {
    const review = makeReview({ traderAction: null });
    const trade = makeClosedTrade({ outcome: 'LOSS', pnl: -200 });
    const result = analyzeDecisionOutcome(review, store, [trade]);
    expect(result?.traderOutcome).toBe('UNFAVORABLE');
    expect(result?.recommendationOutcome).toBeNull();
    expect(result?.recommendationAccuracy).toBe('INCONCLUSIVE');
    expect(result?.realizedPnl).toBe(-200);
  });

  it('incomplete reconstruction => INCONCLUSIVE even with a clear win/loss and known trader action', () => {
    const review = makeReview({ traderAction: 'FOLLOWED_RECOMMENDATION' });
    const trade = makeClosedTrade({ outcome: 'WIN', pnl: 150, reconstructionStatus: 'INCOMPLETE' });
    const result = analyzeDecisionOutcome(review, store, [trade]);
    expect(result?.recommendationAccuracy).toBe('INCONCLUSIVE');
  });

  it('never modifies the review itself (outcomeStatus/realizedPnl untouched)', () => {
    const review = makeReview({ traderAction: 'FOLLOWED_RECOMMENDATION', outcomeStatus: 'PENDING', realizedPnl: null });
    const trade = makeClosedTrade({ outcome: 'WIN', pnl: 150 });
    analyzeDecisionOutcome(review, store, [trade]);
    expect(review.outcomeStatus).toBe('PENDING');
    expect(review.realizedPnl).toBeNull();
  });
});
