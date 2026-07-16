// features/portfolio/dashboard/TodaysPrioritiesDashboard.tsx
//
// PI-0010A: Today's Priorities Dashboard, V1 -- the presentation layer for
// lib/todaysPriorities/dashboard.ts's pure bucketing output.
//
// This component computes nothing. Every objective-bearing subsection
// (Immediate Action; Review Today's medium-priority / earnings / expiring
// buckets; the CSP-opportunity bucket) is rendered by re-using the existing
// <TodaysPriorities> component (features/portfolio/components/TodaysPriorities.tsx,
// PI-0004A) unchanged -- same cards, same priority/urgency/type badges, same
// expand-for-evidence interaction. That component already IS the established
// "badge/theme styling convention" for a PortfolioObjective list, so this
// dashboard reuses it four times (once per objective bucket that needs it)
// instead of re-implementing card/badge markup.
//
// The remaining three subsections -- Monitor entries, Decision Reviews
// needing follow-up, and the roll/covered-call opportunity lists -- are not
// PortfolioObjectives, so they get small, compact rows built from the same
// theme tokens (th.border/th.card/th.textFaint/th.textMuted) rather than a
// new visual language.

'use client';

import { useState } from 'react';
import { THEMES, Theme } from '@/lib/theme';
import { TodaysPriorities } from '../components/TodaysPriorities';
import type {
  TodaysPrioritiesDashboard as TodaysPrioritiesDashboardData,
  TodaysPrioritiesMonitorEntry,
  CoveredCallOpportunityInput,
} from '@/lib/todaysPriorities';
import type { DecisionReview } from '@/lib/decision-review';
import { DECISION_OUTCOME_STATUS_LABEL } from '@/lib/decision-review';

function SectionHeader({ label, count, th }: { label: string; count?: number; th: typeof THEMES[Theme] }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h2 className={`text-[12px] font-bold uppercase tracking-widest ${th.text}`}>{label}</h2>
      {count !== undefined && <span className={`text-[9px] ${th.textFaint}`}>{count} item{count !== 1 ? 's' : ''}</span>}
    </div>
  );
}

function EmptyState({ label, th }: { label: string; th: typeof THEMES[Theme] }) {
  return (
    <div className={`rounded-xl border ${th.borderLight} ${th.card} p-4 text-center`}>
      <p className={`text-[11px] ${th.textFaint}`}>{label}</p>
    </div>
  );
}

function MonitorRow({ entry, th }: { entry: TodaysPrioritiesMonitorEntry; th: typeof THEMES[Theme] }) {
  return (
    <div className={`flex items-center justify-between rounded-lg border ${th.borderLight} ${th.card} px-3 py-2`}>
      <div className="flex min-w-0 items-center gap-2">
        <span className={`text-[11px] font-semibold ${th.text}`}>{entry.symbol}</span>
        <span className={`text-[10px] ${th.textFaint}`}>{entry.strategy}</span>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className={`text-[10px] ${th.textFaint}`}>{entry.dte}d</span>
        <span className={`text-[10px] font-semibold ${th.textMuted}`}>
          {entry.healthScore !== null ? `${entry.healthScore}` : '—'}
        </span>
      </div>
    </div>
  );
}

function NeedsFollowUpRow({ review, th }: { review: DecisionReview; th: typeof THEMES[Theme] }) {
  return (
    <div className={`flex items-center justify-between rounded-lg border ${th.borderLight} ${th.card} px-3 py-2`}>
      <div className="flex min-w-0 items-center gap-2">
        <span className={`text-[11px] font-semibold ${th.text}`}>{review.symbol}</span>
        <span className={`text-[10px] ${th.textFaint}`}>{review.strategy}</span>
      </div>
      <span className={`text-[9px] uppercase tracking-widest ${th.textFaint}`}>
        {DECISION_OUTCOME_STATUS_LABEL[review.outcomeStatus]}
      </span>
    </div>
  );
}

function CoveredCallOpportunityRow({ opp, th }: { opp: CoveredCallOpportunityInput; th: typeof THEMES[Theme] }) {
  return (
    <div className={`flex items-center justify-between rounded-lg border ${th.borderLight} ${th.card} px-3 py-2`}>
      <span className={`text-[11px] font-semibold ${th.text}`}>{opp.symbol}</span>
      <span className={`text-[10px] ${th.textFaint}`}>{opp.shares} sh uncovered</span>
    </div>
  );
}

export interface TodaysPrioritiesDashboardProps {
  dashboard: TodaysPrioritiesDashboardData;
  th: typeof THEMES[Theme];
}

export function TodaysPrioritiesDashboard({ dashboard, th }: TodaysPrioritiesDashboardProps) {
  const [monitorExpanded, setMonitorExpanded] = useState(false);

  const { immediateAction, reviewToday, monitor, opportunities } = dashboard;
  const reviewTodayCount =
    reviewToday.mediumPriority.length +
    reviewToday.earningsReviews.length +
    reviewToday.expiringPositions.length +
    reviewToday.needsFollowUp.length;
  const opportunitiesCount =
    opportunities.rollOpportunities.length +
    opportunities.coveredCallOpportunities.length +
    opportunities.cspOpportunities.length +
    (opportunities.screenerCandidatesAvailable ? 1 : 0);

  const visibleMonitor = monitorExpanded ? monitor : monitor.slice(0, 6);

  return (
    <div className="space-y-8">
      {/* 1. Immediate Action */}
      <section aria-label="Immediate Action">
        <SectionHeader label="Immediate Action" count={immediateAction.length} th={th} />
        {immediateAction.length === 0 ? (
          <EmptyState label="Nothing needs immediate action right now." th={th} />
        ) : (
          <TodaysPriorities objectives={immediateAction} loading={false} th={th} title="Immediate Action" />
        )}
      </section>

      {/* 2. Review Today */}
      <section aria-label="Review Today">
        <SectionHeader label="Review Today" count={reviewTodayCount} th={th} />
        {reviewTodayCount === 0 ? (
          <EmptyState label="Nothing pending review today." th={th} />
        ) : (
          <div className="space-y-5">
            {reviewToday.earningsReviews.length > 0 && (
              <TodaysPriorities objectives={reviewToday.earningsReviews} loading={false} th={th} title="Earnings Reviews" />
            )}
            {reviewToday.expiringPositions.length > 0 && (
              <TodaysPriorities objectives={reviewToday.expiringPositions} loading={false} th={th} title="Expiring Positions" />
            )}
            {reviewToday.mediumPriority.length > 0 && (
              <TodaysPriorities objectives={reviewToday.mediumPriority} loading={false} th={th} title="Medium Priority" />
            )}
            {reviewToday.needsFollowUp.length > 0 && (
              <div>
                <h3 className={`mb-1.5 text-[10px] uppercase tracking-widest ${th.textFaint}`}>
                  Decision Reviews Needing Follow-Up
                </h3>
                <div className="space-y-1.5">
                  {reviewToday.needsFollowUp.map((review) => (
                    <NeedsFollowUpRow key={review.id} review={review} th={th} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 3. Monitor */}
      <section aria-label="Monitor">
        <SectionHeader label="Monitor" count={monitor.length} th={th} />
        {monitor.length === 0 ? (
          <EmptyState label="No healthy positions to display." th={th} />
        ) : (
          <div className="space-y-1.5">
            {visibleMonitor.map((entry) => (
              <MonitorRow key={entry.key} entry={entry} th={th} />
            ))}
            {monitor.length > 6 && (
              <button
                type="button"
                onClick={() => setMonitorExpanded((v) => !v)}
                className={`text-[10px] font-semibold ${th.textFaint} hover:${th.text}`}
              >
                {monitorExpanded ? 'Show less' : `Show all ${monitor.length}`}
              </button>
            )}
          </div>
        )}
      </section>

      {/* 4. Opportunities */}
      <section aria-label="Opportunities">
        <SectionHeader label="Opportunities" count={opportunitiesCount} th={th} />
        {opportunitiesCount === 0 ? (
          <EmptyState label="No opportunities surfaced right now." th={th} />
        ) : (
          <div className="space-y-5">
            {opportunities.rollOpportunities.length > 0 && (
              <TodaysPriorities objectives={opportunities.rollOpportunities} loading={false} th={th} title="Roll Opportunities" />
            )}
            {opportunities.cspOpportunities.length > 0 && (
              <TodaysPriorities objectives={opportunities.cspOpportunities} loading={false} th={th} title="CSP Opportunities" />
            )}
            {opportunities.coveredCallOpportunities.length > 0 && (
              <div>
                <h3 className={`mb-1.5 text-[10px] uppercase tracking-widest ${th.textFaint}`}>Covered Call Opportunities</h3>
                <div className="space-y-1.5">
                  {opportunities.coveredCallOpportunities.map((opp) => (
                    <CoveredCallOpportunityRow key={opp.key} opp={opp} th={th} />
                  ))}
                </div>
              </div>
            )}
            {opportunities.screenerCandidatesAvailable && (
              <div className={`rounded-lg border ${th.borderLight} ${th.card} px-3 py-2`}>
                <p className={`text-[11px] ${th.textMuted}`}>
                  New screener candidates are available &mdash; check the Screener page.
                </p>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
