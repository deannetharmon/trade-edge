// lib/portfolioReview/index.ts
//
// PI-0012A: Portfolio Review, Phase 1 -- Composition Layer. See
// buildPortfolioReview.ts's module doc and
// docs/design/PI-0012-Portfolio-Review-Architecture.md for the full
// rationale. No existing engine imports from this package (one-way
// dependency, matching every other lib/ orchestration package in this repo).

export { buildPortfolioReview, selectTopRisks, DEFAULT_TOP_RISKS_LIMIT } from './buildPortfolioReview';
export type {
  PortfolioReviewInput,
  PortfolioReviewPositionInput,
  PortfolioReviewSnapshot,
  PortfolioReviewCurrentState,
  PortfolioReviewComposition,
} from './types';
