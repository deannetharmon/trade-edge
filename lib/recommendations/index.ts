// lib/recommendations/index.ts
//
// CES-0001 (OE-0002B, Quinn review correction): public module interface for
// the Recommendation Service. Consumers (and future producers) should
// import from '@/lib/recommendations', never from
// '@/lib/recommendations/RecommendationService' directly -- this decouples
// callers from the concrete implementation module so it may evolve later
// (e.g. gaining persistence, or being split into multiple files) without
// requiring any consumer import to change.
//
// Re-exports only; no behavior is added or altered here.

export {
  useCurrentRecommendations,
  getCurrentRecommendations,
  publishRecommendations,
  clearRecommendations,
  subscribeToRecommendations,
} from './RecommendationService';
export type { RecommendationSet } from './RecommendationService';
