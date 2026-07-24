// lib/todaysPriorities/index.ts
//
// PI-0010A: Today's Priorities Dashboard, V1.
// PI-0010B: Intelligent Prioritization -- PrioritizedObjective added.
// PI-0011A: Portfolio Mission Control -- selectTopPriority added.
// MB-0001A: buildRecommendationExplanation/RecommendationExplanation exported
// here (previously only reachable via the deep path
// lib/todaysPriorities/explanation) so lib/morning-briefing -- and any future
// package outside this one -- can import the existing, unmodified
// explanation logic through this module's public surface instead of
// reaching into an internal file. No behavior changed; this is a
// re-export only.

export { buildTodaysPrioritiesDashboard, selectTopPriority } from './dashboard';
export type {
  TodaysPrioritiesInput,
  TodaysPrioritiesPositionInput,
  CoveredCallOpportunityInput,
  PrioritizedObjective,
  TodaysPrioritiesDashboard,
  TodaysPrioritiesReviewToday,
  TodaysPrioritiesMonitorEntry,
  TodaysPrioritiesOpportunities,
} from './dashboard';

export { buildRecommendationExplanation } from './explanation';
export type {
  RecommendationExplanation,
  RecommendationDriver,
  RecommendationConfidenceLabel,
} from './explanation';
