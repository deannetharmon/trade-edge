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
  // PO corrective round 4 (WA-0005 Defect 1): the real evaluation-lifecycle
  // signal, additive to the existing publish/clear pair -- see
  // RecommendationService.ts's own doc comments.
  beginRecommendationsEvaluation,
  failRecommendationsEvaluation,
  clearRecommendations,
  subscribeToRecommendations,
} from './RecommendationService';
export type { RecommendationSet, RecommendationEvaluationStatus } from './RecommendationService';
export {
  buildBatchedRecommendationTransportPlan,
  evaluateScreenResultsInBatches,
  RECOMMENDATION_ENGINE_BUSY_CODE,
  DEFAULT_BUSY_RETRY_LIMIT,
  DEFAULT_BUSY_RETRY_BASE_DELAY_MS,
  DEFAULT_BUSY_RETRY_MAX_DELAY_MS,
  RECOMMENDATION_SAFE_REQUEST_BYTES,
  VERCEL_FUNCTION_BODY_LIMIT_BYTES,
} from './screenerRecommendationTransport';
export type {
  BatchedRecommendationApiBody,
  BatchedRecommendationTransportPlan,
  RecommendationCandidateBatch,
} from './screenerRecommendationTransport';
