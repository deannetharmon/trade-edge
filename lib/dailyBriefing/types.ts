// lib/dailyBriefing/types.ts
//
// PI-0013: Daily Briefing Dashboard.
//
// The Daily Briefing is an orchestration layer, not a fourth intelligence
// engine. Every field below is either a direct pass-through of an existing
// type (PortfolioHealthResult via PortfolioReviewSnapshot, PrioritizedObjective,
// PortfolioObjective) or a plain presentational grouping of fields those
// types already carry (count, label, detail string). Nothing here is a new
// score, a new recommendation, or a new evaluation -- see
// docs/design/PI-0012-Portfolio-Review-Architecture.md and
// docs/reviews/PI-0013-Daily-Briefing-Implementation-Report.md for the full
// rationale and reuse map.

import type { PortfolioObjective } from '@/lib/portfolio-intelligence';
import type { PrioritizedObjective, TodaysPrioritiesDashboard } from '@/lib/todaysPriorities';
import type { PortfolioReviewSnapshot } from '@/lib/portfolioReview';

// ---------------------------------------------------------------------------
// Input -- everything here is a value the caller (app/portfolio/page.tsx)
// already computed for some other purpose (Portfolio Review, Today's
// Priorities, Portfolio Health). Nothing is fetched, evaluated, or
// re-ranked by this module.
// ---------------------------------------------------------------------------

export interface DailyBriefingInput {
  // PI-0012A's already-composed snapshot -- reused verbatim for Portfolio
  // Health, Top Risks (this module's `priorities`), and the concentration/
  // capital concerns that feed Risk Summary. Never recomputed here.
  portfolioReview: PortfolioReviewSnapshot;
  // PI-0010A/B's already-bucketed-and-scored dashboard -- Upcoming Events
  // (DTE/earnings/follow-up buckets) and Opportunity Summary (roll/covered
  // call/CSP/screener buckets) are direct reads of buckets this dashboard
  // already built for exactly this purpose. Immediate Action feeds Risk
  // Summary's "positions requiring immediate attention" category.
  dashboard: TodaysPrioritiesDashboard;
  // The full canonical objective list (same list already passed into
  // computeCanonicalPortfolioPriorities/buildPortfolioReview) -- consulted
  // only for its existing, stable `ruleId` tag ('OBJ-ASSIGNMENT-RISK') to
  // build the Assignment Exposure risk category. Not re-evaluated.
  objectives: PortfolioObjective[];
  // Already computed by the page (the same reduction healthInput's own
  // useMemo performs for Portfolio Health) -- passed through, never
  // recomputed a second time here.
  averagePositionHealth: number | null;
  // Already computed real balance data (balances?.buyingPowerUsedPct on the
  // page, the same value healthInput/PortfolioReviewInput already read).
  capitalDeploymentPct: number | null;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface DailyBriefingSnapshot {
  healthScore: number;
  healthStatus: PortfolioReviewSnapshot['currentState']['health']['status'];
  openPositionCount: number;
  capitalDeploymentPct: number | null;
  largestConcentrationPct: number | null;
  averagePositionHealth: number | null;
}

export type UpcomingEventKind = 'dte' | 'earnings' | 'decision_review_follow_up';

export interface UpcomingEvent {
  id: string;
  kind: UpcomingEventKind;
  label: string;
  symbol: string | null;
  detail: string;
}

export type OpportunityKind = 'roll' | 'covered_call' | 'csp' | 'screener';

export interface OpportunityItem {
  kind: OpportunityKind;
  label: string;
  count: number;
}

export type RiskKind = 'concentration' | 'capital' | 'assignment_exposure' | 'earnings_exposure' | 'immediate_attention';

export interface RiskItem {
  id: string;
  kind: RiskKind;
  label: string;
  detail: string;
}

export interface DailyBriefing {
  generatedAt: string;
  executiveSummary: string;
  // PI-0012A's already-scored, already-limited-to-5 Top Risks, reused
  // verbatim -- see buildDailyBriefing.ts's module doc. Not re-ranked.
  priorities: PrioritizedObjective[];
  snapshot: DailyBriefingSnapshot;
  upcomingEvents: UpcomingEvent[];
  opportunities: OpportunityItem[];
  risks: RiskItem[];
}
