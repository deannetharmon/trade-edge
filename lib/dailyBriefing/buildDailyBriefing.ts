// lib/dailyBriefing/buildDailyBriefing.ts
//
// PI-0013: Daily Briefing Dashboard.
//
// A pure function only: no fetch, no Redis, no React, no internet calls, no
// AI/LLM calls. Nothing here reads the clock except via the explicit,
// overridable `now` parameter (matching this codebase's existing
// convention). Every section below is either a verbatim pass-through of an
// already-computed input or a deterministic string/grouping built from
// fields those inputs already carry -- nothing here evaluates a position,
// ranks an objective, or computes a new score/recommendation. This module is
// NOT another Portfolio Review and NOT another recommendation engine; it
// composes PI-0012A's PortfolioReviewSnapshot and PI-0010A/B's
// TodaysPrioritiesDashboard into one "read this in 30 seconds" summary. See
// docs/reviews/PI-0013-Daily-Briefing-Implementation-Report.md for the full
// reuse map.

import type { PortfolioObjective } from '@/lib/portfolio-intelligence';
import type { PrioritizedObjective, TodaysPrioritiesDashboard } from '@/lib/todaysPriorities';
import type { PortfolioReviewSnapshot } from '@/lib/portfolioReview';
import type {
  DailyBriefing,
  DailyBriefingInput,
  DailyBriefingSnapshot,
  OpportunityItem,
  RiskItem,
  UpcomingEvent,
} from './types';

function buildSnapshot(
  review: PortfolioReviewSnapshot,
  averagePositionHealth: number | null,
  capitalDeploymentPct: number | null,
): DailyBriefingSnapshot {
  return {
    healthScore: review.currentState.health.score,
    healthStatus: review.currentState.health.status,
    openPositionCount: review.composition.positionCount,
    capitalDeploymentPct,
    largestConcentrationPct: review.composition.maxSymbolConcentrationPct,
    averagePositionHealth,
  };
}

// Reads exactly the three buckets Today's Priorities already built for this
// purpose (dashboard.reviewToday.expiringPositions / .earningsReviews /
// .needsFollowUp) -- no new trigger-type filtering, no new date math. Each
// bucket is already sorted (Priority Score, or recency for needsFollowUp);
// order between the three groups below is fixed (DTE, then earnings, then
// follow-up) so output is deterministic across calls with identical input.
function buildUpcomingEvents(dashboard: TodaysPrioritiesDashboard): UpcomingEvent[] {
  const events: UpcomingEvent[] = [];

  for (const { objective } of dashboard.reviewToday.expiringPositions) {
    events.push({
      id: `dte_${objective.id}`,
      kind: 'dte',
      label: objective.title,
      symbol: objective.subject.symbol ?? null,
      detail: objective.summary,
    });
  }

  for (const { objective } of dashboard.reviewToday.earningsReviews) {
    events.push({
      id: `earnings_${objective.id}`,
      kind: 'earnings',
      label: objective.title,
      symbol: objective.subject.symbol ?? null,
      detail: objective.summary,
    });
  }

  for (const review of dashboard.reviewToday.needsFollowUp) {
    events.push({
      id: `followup_${review.id}`,
      kind: 'decision_review_follow_up',
      label: `${review.symbol} decision review needs follow-up`,
      symbol: review.symbol,
      detail: `Recommended "${review.evidence.label}" is still pending an outcome.`,
    });
  }

  return events;
}

// Reads the same four portfolio-derived opportunity buckets (roll/covered
// call/CSP/screener-candidate counts) the legacy Portfolio-tab Mission
// Control's own Opportunity Summary used to count before that tab was
// retired in WA-0002 -- no new opportunity discovery, no new counting rule.
// (Distinct from /dashboard's screener-sourced NewOpportunitiesSection,
// MB-0002, which surfaces OpportunityRecommendation candidates from the
// Opportunity Engine, not this dashboard-derived count.) All four buckets
// are always present here (even at count 0) so the UI can render a stable,
// predictable four-stat layout.
function buildOpportunitySummary(dashboard: TodaysPrioritiesDashboard): OpportunityItem[] {
  const { opportunities } = dashboard;
  return [
    { kind: 'roll', label: 'Roll Opportunities', count: opportunities.rollOpportunities.length },
    { kind: 'covered_call', label: 'Covered Call Opportunities', count: opportunities.coveredCallOpportunities.length },
    { kind: 'csp', label: 'CSP Opportunities', count: opportunities.cspOpportunities.length },
    { kind: 'screener', label: 'Screener Candidates Available', count: opportunities.screenerCandidatesAvailable ? 1 : 0 },
  ];
}

// Five categories, each a direct read of an already-existing, already-tagged
// source -- concentration/capital from PI-0012A's Portfolio Review
// currentState (unchanged), assignment exposure from the canonical
// objective list's own stable `ruleId` tag (OBJ-ASSIGNMENT-RISK, already
// assigned by evaluatePortfolioObjectives()), earnings exposure from Today's
// Priorities' own earnings bucket, and immediate attention from Today's
// Priorities' own Immediate Action bucket. No new risk is invented and no
// objective is re-evaluated.
function buildRiskSummary(
  review: PortfolioReviewSnapshot,
  dashboard: TodaysPrioritiesDashboard,
  objectives: PortfolioObjective[],
): RiskItem[] {
  const risks: RiskItem[] = [];

  for (const o of review.currentState.concentrationConcerns) {
    risks.push({ id: `concentration_${o.id}`, kind: 'concentration', label: o.title, detail: o.summary });
  }

  for (const o of review.currentState.capitalConcerns) {
    risks.push({ id: `capital_${o.id}`, kind: 'capital', label: o.title, detail: o.summary });
  }

  for (const o of objectives.filter((obj) => obj.ruleId === 'OBJ-ASSIGNMENT-RISK')) {
    risks.push({ id: `assignment_${o.id}`, kind: 'assignment_exposure', label: o.title, detail: o.summary });
  }

  for (const { objective } of dashboard.reviewToday.earningsReviews) {
    risks.push({ id: `earnings_risk_${objective.id}`, kind: 'earnings_exposure', label: objective.title, detail: objective.summary });
  }

  for (const { objective } of dashboard.immediateAction) {
    risks.push({ id: `immediate_${objective.id}`, kind: 'immediate_attention', label: objective.title, detail: objective.summary });
  }

  return risks;
}

// Deterministic, template-based sentence generation -- no AI, no LLM, no
// internet calls, no free-text generation. Every clause below reads a field
// this module (or its inputs) already computed; nothing is inferred fresh.
// Mirrors features/portfolio/briefing/portfolioSummary.ts's existing
// "presence/absence over already-known facts" pattern, applied to a single
// flowing paragraph instead of a bulleted list.
function buildExecutiveSummary(
  review: PortfolioReviewSnapshot,
  dashboard: TodaysPrioritiesDashboard,
  risks: RiskItem[],
  upcomingEvents: UpcomingEvent[],
): string {
  const sentences: string[] = [];

  sentences.push(`Portfolio is ${review.currentState.health.status}.`);

  const immediateCount = dashboard.immediateAction.length;
  if (immediateCount > 0) {
    sentences.push(`${immediateCount} position${immediateCount === 1 ? '' : 's'} require${immediateCount === 1 ? 's' : ''} attention today.`);
  } else {
    sentences.push('No positions require immediate attention today.');
  }

  const concentrationCount = review.currentState.concentrationConcerns.length;
  if (concentrationCount > 0) {
    sentences.push(`${review.currentState.concentrationConcerns[0].title.replace(/^Reduce Concentration: /, '')} concentration remains elevated.`);
  }

  const earningsCount = upcomingEvents.filter((e) => e.kind === 'earnings').length;
  sentences.push(
    earningsCount > 0
      ? `${earningsCount} earnings event${earningsCount === 1 ? '' : 's'} fall${earningsCount === 1 ? 's' : ''} before the next management window.`
      : 'No earnings events occur before the next management window.',
  );

  return sentences.join(' ');
}

export function buildDailyBriefing(input: DailyBriefingInput, now: Date = new Date()): DailyBriefing {
  const { portfolioReview, dashboard, objectives } = input;

  // PI-0012A's own Top Risks, already scored and limited to 5 -- passed
  // through unchanged. This module never re-ranks or re-scores objectives.
  const priorities: PrioritizedObjective[] = portfolioReview.currentState.topRisks;

  const upcomingEvents = buildUpcomingEvents(dashboard);
  const opportunities = buildOpportunitySummary(dashboard);
  const risks = buildRiskSummary(portfolioReview, dashboard, objectives);
  const snapshot = buildSnapshot(portfolioReview, input.averagePositionHealth, input.capitalDeploymentPct);
  const executiveSummary = buildExecutiveSummary(portfolioReview, dashboard, risks, upcomingEvents);

  return {
    generatedAt: now.toISOString(),
    executiveSummary,
    priorities,
    snapshot,
    upcomingEvents,
    opportunities,
    risks,
  };
}
