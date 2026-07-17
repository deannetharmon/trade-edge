// lib/dailyBriefing/index.ts
//
// PI-0013: Daily Briefing Dashboard. See buildDailyBriefing.ts's module doc
// and docs/reviews/PI-0013-Daily-Briefing-Implementation-Report.md for the
// full rationale. No existing engine imports from this package (one-way
// dependency, matching lib/portfolioReview and every other lib/
// orchestration package in this repo).

export { buildDailyBriefing } from './buildDailyBriefing';
export type {
  DailyBriefing,
  DailyBriefingInput,
  DailyBriefingSnapshot,
  UpcomingEvent,
  UpcomingEventKind,
  OpportunityItem,
  OpportunityKind,
  RiskItem,
  RiskKind,
} from './types';
