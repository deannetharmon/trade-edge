// lib/position-snapshot/__tests__/snapshotEngine.test.ts
//
// PI-0009A: Position Snapshot Engine, V1 -- targeted tests for the pure
// planning logic: initial detection, recommendation-change detection,
// no-change no-capture, position-close detection via key diffing, and
// never double-capturing a close.

import { describe, expect, it } from 'vitest';
import {
  planLifecycleSnapshots,
  shouldCaptureDetection,
  shouldCaptureRecommendationChange,
  detectClosedPositionKeys,
  createPositionSnapshot,
} from '../snapshotEngine';
import type { PositionSnapshotInput, PositionSnapshotStore } from '../types';

function makeInput(overrides: Partial<PositionSnapshotInput> = {}): PositionSnapshotInput {
  return {
    key: 'pos_1',
    symbol: 'SOXL',
    strategy: 'BPS',
    dte: 21,
    creditReceived: 200,
    closeValue: 50,
    delta: -0.15,
    pop: 78,
    netEdge: 12,
    healthScore: 82,
    remainingOpportunityPct: 40,
    recommendationLabel: 'Hold Position',
    confidence: 70,
    primaryReason: 'Healthy buffer and positive net edge',
    supportingReasons: ['DTE within normal range'],
    earningsStatus: 'NONE',
    earningsDate: null,
    ...overrides,
  };
}

describe('planLifecycleSnapshots: initial detection', () => {
  it('captures POSITION_DETECTED for a position with no snapshot history', () => {
    const store: PositionSnapshotStore = {};
    const { toAppend } = planLifecycleSnapshots([makeInput()], store, '2026-07-01T00:00:00.000Z');
    expect(toAppend).toHaveLength(1);
    expect(toAppend[0].event).toBe('POSITION_DETECTED');
    expect(toAppend[0].positionKey).toBe('pos_1');
    expect(toAppend[0].recommendation).toBe('Hold Position');
    expect(toAppend[0].keyEvidence).toEqual(['Healthy buffer and positive net edge', 'DTE within normal range']);
  });

  it('shouldCaptureDetection is false once a snapshot exists', () => {
    const first = createPositionSnapshot(makeInput(), 'POSITION_DETECTED');
    const store: PositionSnapshotStore = { pos_1: [first] };
    expect(shouldCaptureDetection(store, 'pos_1')).toBe(false);
    expect(shouldCaptureDetection(store, 'pos_2')).toBe(true);
  });
});

describe('planLifecycleSnapshots: recommendation changes', () => {
  it('captures RECOMMENDATION_CHANGE when the label differs from the last snapshot', () => {
    const prior = createPositionSnapshot(makeInput({ recommendationLabel: 'Hold Position' }), 'POSITION_DETECTED', '2026-07-01T00:00:00.000Z');
    const store: PositionSnapshotStore = { pos_1: [prior] };
    const current = makeInput({ recommendationLabel: 'Cut Losses' });

    expect(shouldCaptureRecommendationChange(store, 'pos_1', 'Cut Losses')).toBe(true);

    const { toAppend } = planLifecycleSnapshots([current], store, '2026-07-05T00:00:00.000Z');
    expect(toAppend).toHaveLength(1);
    expect(toAppend[0].event).toBe('RECOMMENDATION_CHANGE');
    expect(toAppend[0].recommendation).toBe('Cut Losses');
  });

  it('does not capture anything when the recommendation is unchanged', () => {
    const prior = createPositionSnapshot(makeInput({ recommendationLabel: 'Hold Position' }), 'POSITION_DETECTED', '2026-07-01T00:00:00.000Z');
    const store: PositionSnapshotStore = { pos_1: [prior] };
    const current = makeInput({ recommendationLabel: 'Hold Position' });

    expect(shouldCaptureRecommendationChange(store, 'pos_1', 'Hold Position')).toBe(false);
    const { toAppend } = planLifecycleSnapshots([current], store, '2026-07-05T00:00:00.000Z');
    expect(toAppend).toHaveLength(0);
  });

  it('never flags a change for a position whose last snapshot already recorded its close', () => {
    const closed = createPositionSnapshot(makeInput({ recommendationLabel: 'Take Profit' }), 'POSITION_CLOSE', '2026-07-01T00:00:00.000Z');
    const store: PositionSnapshotStore = { pos_1: [closed] };
    expect(shouldCaptureRecommendationChange(store, 'pos_1', 'Hold Position')).toBe(false);
  });
});

describe('planLifecycleSnapshots: position close', () => {
  it('detects a position with history that has dropped out of the live position list', () => {
    const prior = createPositionSnapshot(makeInput(), 'POSITION_DETECTED', '2026-07-01T00:00:00.000Z');
    const store: PositionSnapshotStore = { pos_1: [prior] };

    expect(detectClosedPositionKeys(store, [])).toEqual(['pos_1']);
    expect(detectClosedPositionKeys(store, ['pos_1'])).toEqual([]); // still open -- not closed
  });

  it('builds the POSITION_CLOSE snapshot from the position\'s own last known values, not fabricated data', () => {
    const prior = createPositionSnapshot(
      makeInput({ recommendationLabel: 'Take Profit', healthScore: 91, netEdge: 5 }),
      'RECOMMENDATION_CHANGE',
      '2026-07-01T00:00:00.000Z',
    );
    const store: PositionSnapshotStore = { pos_1: [prior] };

    // pos_1 no longer appears in the live position list passed in.
    const { toAppend } = planLifecycleSnapshots([], store, '2026-07-10T00:00:00.000Z');
    expect(toAppend).toHaveLength(1);
    expect(toAppend[0].event).toBe('POSITION_CLOSE');
    expect(toAppend[0].positionKey).toBe('pos_1');
    expect(toAppend[0].capturedAt).toBe('2026-07-10T00:00:00.000Z');
    expect(toAppend[0].healthScore).toBe(91); // carried over from the last known snapshot
    expect(toAppend[0].netEdge).toBe(5);
    expect(toAppend[0].recommendation).toBe('Take Profit');
    expect(toAppend[0].id).not.toBe(prior.id); // distinct snapshot, not a mutation of the original
  });

  it('never double-captures a close for a position already marked POSITION_CLOSE', () => {
    const closed = createPositionSnapshot(makeInput(), 'POSITION_CLOSE', '2026-07-01T00:00:00.000Z');
    const store: PositionSnapshotStore = { pos_1: [closed] };
    expect(detectClosedPositionKeys(store, [])).toEqual([]);
    const { toAppend } = planLifecycleSnapshots([], store, '2026-07-10T00:00:00.000Z');
    expect(toAppend).toHaveLength(0);
  });
});

describe('planLifecycleSnapshots: mixed batch', () => {
  it('handles detection, an unchanged position, a recommendation change, and a close in one call', () => {
    const storeBefore: PositionSnapshotStore = {
      pos_unchanged: [createPositionSnapshot(makeInput({ key: 'pos_unchanged', recommendationLabel: 'Hold Position' }), 'POSITION_DETECTED')],
      pos_changed:   [createPositionSnapshot(makeInput({ key: 'pos_changed', recommendationLabel: 'Hold Position' }), 'POSITION_DETECTED')],
      pos_closing:   [createPositionSnapshot(makeInput({ key: 'pos_closing', recommendationLabel: 'Take Profit' }), 'POSITION_DETECTED')],
    };

    const livePositions = [
      makeInput({ key: 'pos_unchanged', recommendationLabel: 'Hold Position' }),
      makeInput({ key: 'pos_changed', recommendationLabel: 'Cut Losses' }),
      makeInput({ key: 'pos_new', recommendationLabel: 'Watch' }),
      // pos_closing is intentionally absent -- it closed.
    ];

    const { toAppend } = planLifecycleSnapshots(livePositions, storeBefore, '2026-07-15T00:00:00.000Z');
    const byKey = Object.fromEntries(toAppend.map(s => [s.positionKey, s]));

    expect(toAppend).toHaveLength(3); // pos_unchanged produces nothing
    expect(byKey['pos_new'].event).toBe('POSITION_DETECTED');
    expect(byKey['pos_changed'].event).toBe('RECOMMENDATION_CHANGE');
    expect(byKey['pos_closing'].event).toBe('POSITION_CLOSE');
    expect(byKey['pos_unchanged']).toBeUndefined();
  });
});
