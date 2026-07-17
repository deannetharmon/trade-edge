// lib/position-snapshot/index.ts
//
// PI-0009A: Position Snapshot Engine, V1.

export {
  createPositionSnapshot,
  latestSnapshotForPosition,
  appendPositionSnapshot,
  shouldCaptureDetection,
  shouldCaptureRecommendationChange,
  detectClosedPositionKeys,
  planLifecycleSnapshots,
} from './snapshotEngine';
export type { LifecycleSnapshotPlan } from './snapshotEngine';

export type {
  PositionSnapshotEvent,
  EarningsStatus,
  PositionLifecycleSnapshot,
  PositionSnapshotStore,
  PositionSnapshotInput,
} from './types';
