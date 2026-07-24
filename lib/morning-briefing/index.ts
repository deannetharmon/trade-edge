// lib/morning-briefing/index.ts
//
// MB-0001A: public interface for the Morning Briefing Attention Feed.
// Consumers should import from '@/lib/morning-briefing', not from
// './attentionFeed' or './types' directly.

export { buildAttentionFeed } from './attentionFeed';
export type {
  AttentionBand,
  AttentionSource,
  AttentionExplanation,
  AttentionItem,
  AttentionFeed,
  BuildAttentionFeedInput,
} from './types';
