// lib/todays-priorities-queue/index.ts
//
// WA-0003: public interface for the canonical Today's Priorities queue.
// Consumers should import from '@/lib/todays-priorities-queue', not from
// './buildTodaysPrioritiesQueue' or './types' directly.

export {
  buildTodaysPrioritiesQueue,
  partitionTodaysPrioritiesQueue,
  getStableQueueKey,
} from './buildTodaysPrioritiesQueue';
export type { BuildTodaysPrioritiesQueueInput } from './buildTodaysPrioritiesQueue';
export type {
  TodaysPrioritiesQueueItemKind,
  TodaysPrioritiesQueueItem,
  TodaysPrioritiesQueue,
  TodaysPrioritiesQueuePartition,
} from './types';
