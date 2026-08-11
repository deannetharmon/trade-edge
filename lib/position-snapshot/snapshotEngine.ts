// lib/position-snapshot/snapshotEngine.ts
//
// PI-0009A: Position Snapshot Engine, V1. Pure functions only -- no network,
// no Redis, no React. app/api/position-lifecycle-snapshots/route.ts persists
// what this module decides to capture; app/portfolio/page.tsx supplies the
// live position data and calls planLifecycleSnapshots() once per load.

import type {
  PositionSnapshotEvent,
  PositionLifecycleSnapshot,
  PositionSnapshotStore,
  PositionSnapshotInput,
} from './types';

function createSnapshotId(): string {
  return `psnap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createPositionSnapshot(
  input: PositionSnapshotInput,
  event: PositionSnapshotEvent,
  capturedAt: string = new Date().toISOString(),
): PositionLifecycleSnapshot {
  return {
    id: createSnapshotId(),
    positionKey: input.key,
    event,
    capturedAt,
    symbol: input.symbol,
    strategy: input.strategy,
    dte: input.dte,
    creditReceived: input.creditReceived,
    entryEconomicsComplete: input.entryEconomicsComplete,
    closeValue: input.closeValue,
    delta: input.delta,
    pop: input.pop,
    netEdge: input.netEdge,
    healthScore: input.healthScore,
    remainingOpportunityPct: input.remainingOpportunityPct,
    recommendation: input.recommendationLabel,
    confidence: input.confidence,
    keyEvidence: [input.primaryReason, ...input.supportingReasons].filter((r): r is string => !!r),
    earningsStatus: input.earningsStatus,
    earningsDate: input.earningsDate,
  };
}

export function latestSnapshotForPosition(store: PositionSnapshotStore, positionKey: string): PositionLifecycleSnapshot | null {
  const list = store[positionKey];
  if (!list || list.length === 0) return null;
  return list[list.length - 1];
}

export function appendPositionSnapshot(store: PositionSnapshotStore, snapshot: PositionLifecycleSnapshot): PositionSnapshotStore {
  const existing = store[snapshot.positionKey] ?? [];
  return { ...store, [snapshot.positionKey]: [...existing, snapshot] };
}

// No snapshot at all yet for this key -- this is the first time we've ever
// seen this position.
export function shouldCaptureDetection(store: PositionSnapshotStore, positionKey: string): boolean {
  return latestSnapshotForPosition(store, positionKey) == null;
}

// The most recently recorded recommendation for this position differs from
// what it is right now. A position with no snapshot history yet doesn't
// qualify -- that's a detection, not a change -- and a position whose last
// snapshot already recorded its close never gets a further "change" (closed
// positions are done; see detectClosedPositionKeys instead).
export function shouldCaptureRecommendationChange(
  store: PositionSnapshotStore,
  positionKey: string,
  currentRecommendationLabel: string | null,
): boolean {
  const latest = latestSnapshotForPosition(store, positionKey);
  if (!latest) return false;
  if (latest.event === 'POSITION_CLOSE') return false;
  return latest.recommendation !== currentRecommendationLabel;
}

// Position keys with snapshot history that are no longer present in the
// current live position list -- i.e. closed since the last time this ran --
// excluding any key whose most recent snapshot is already a POSITION_CLOSE
// (never double-capture the same close).
export function detectClosedPositionKeys(store: PositionSnapshotStore, openPositionKeys: string[]): string[] {
  const openSet = new Set(openPositionKeys);
  return Object.keys(store).filter(key => {
    if (openSet.has(key)) return false;
    const latest = latestSnapshotForPosition(store, key);
    return latest != null && latest.event !== 'POSITION_CLOSE';
  });
}

export interface LifecycleSnapshotPlan {
  toAppend: PositionLifecycleSnapshot[];
}

// Main orchestrator. Given the live positions (already mapped into the lean
// input shape) and the current snapshot store, decides exactly which new
// snapshots to append this cycle:
//   - a brand-new position gets a POSITION_DETECTED snapshot
//   - an existing position whose recommendation changed since its last
//     snapshot gets a RECOMMENDATION_CHANGE snapshot (at most one new
//     snapshot per open position per call -- detection takes priority,
//     since a brand-new position can't have "changed" from anything yet)
//   - a position with snapshot history that's no longer in the live list
//     gets a POSITION_CLOSE snapshot, cloned from its own last known
//     snapshot (already-recorded values), since a position that's gone from
//     the broker feed has no fresher live data left to read -- this is the
//     documented V1 limitation: closure is detected on the next load after
//     the fact, using the last-observed state, not live at-the-moment-of-
//     close data.
export function planLifecycleSnapshots(
  positions: PositionSnapshotInput[],
  store: PositionSnapshotStore,
  capturedAt: string = new Date().toISOString(),
): LifecycleSnapshotPlan {
  const toAppend: PositionLifecycleSnapshot[] = [];

  for (const pos of positions) {
    if (shouldCaptureDetection(store, pos.key)) {
      toAppend.push(createPositionSnapshot(pos, 'POSITION_DETECTED', capturedAt));
      continue;
    }
    if (shouldCaptureRecommendationChange(store, pos.key, pos.recommendationLabel)) {
      toAppend.push(createPositionSnapshot(pos, 'RECOMMENDATION_CHANGE', capturedAt));
    }
  }

  const openKeys = positions.map(p => p.key);
  for (const closedKey of detectClosedPositionKeys(store, openKeys)) {
    const lastKnown = latestSnapshotForPosition(store, closedKey);
    if (!lastKnown) continue; // unreachable given detectClosedPositionKeys' own check; kept defensive
    toAppend.push({
      ...lastKnown,
      id: createSnapshotId(),
      event: 'POSITION_CLOSE',
      capturedAt,
    });
  }

  return { toAppend };
}
