// features/portfolio/dashboard/TodaysPrioritiesDashboard.tsx
//
// PI-0010A: Today's Priorities Dashboard, V1 -- the presentation layer for
// lib/todaysPriorities/dashboard.ts's pure bucketing output.
// PI-0010B: Intelligent Prioritization -- every objective-bearing bucket is
// now a PrioritizedObjective[] (already sorted highest Priority Score first
// by the pure module), rendered here via the new <PriorityRankedList>
// instead of the PI-0004A <TodaysPriorities> component. <TodaysPriorities>
// is still used elsewhere (the Briefing and Priority List tabs) and is
// deliberately left untouched -- it doesn't know about Priority Score, and
// this ticket's brief is "only improve prioritization", not redesign that
// shared component. <PriorityRankedList> is new, local to this dashboard,
// and displays exactly the four things the brief asks for on each card:
// Priority Score, tier (Critical/High/Medium/Low), Expected Portfolio
// Impact (objective.portfolioImpact -- already computed, not recalculated
// here), and the concise Reason bullets calculatePriorityScore() produced.
//
// The remaining subsections -- Monitor entries, Decision Reviews needing
// follow-up, and the covered-call opportunity list -- are not
// PortfolioObjectives (Monitor is explicitly "no action needed", and
// Covered Call opportunities have no backing objective to score), so they
// keep their PI-0010A compact rows, unchanged, built from the same theme
// tokens (th.border/th.card/th.textFaint/th.textMuted).

'use client';

import { useState } from 'react';
import { THEMES, Theme } from '@/lib/theme';
import type {
  TodaysPrioritiesDashboard as TodaysPrioritiesDashboardData,
  TodaysPrioritiesMonitorEntry,
  CoveredCallOpportunityInput,
  PrioritizedObjective,
} from '@/lib/todaysPriorities';
import type { DecisionReview } from '@/lib/decision-review';
import { DECISION_OUTCOME_STATUS_LABEL } from '@/lib/decision-review';
import type { PriorityTier } from '@/lib/priorityScore';

// Mirrors (does not import -- that map is module-private to
// features/portfolio/components/TodaysPriorities.tsx) the same red/orange/
// amber/slate priority color convention already established there, applied
// to this ticket's own Critical/High/Medium/Low Priority Score tier instead
// of PortfolioObjective['priority']. Same visual language, new dimension.
const TIER_STYLE: Record<PriorityTier, { border: string; bg: string; text: string }> = {
  Critical: { border: 'border-red-500/60', bg: 'bg-red-500/10', text: 'text-red-300' },
  High: { border: 'border-orange-500/60', bg: 'bg-orange-500/10', text: 'text-orange-300' },
  Medium: { border: 'border-amber-500/60', bg: 'bg-amber-500/10', text: 'text-amber-300' },
  Low: { border: 'border-slate-500/60', bg: 'bg-slate-500/10', text: 'text-slate-300' },
};

const IMPACT_DIRECTION_ARROW: Record<'positive' | 'negative' | 'neutral', string> = {
  positive: '↑',
  negative: '↓',
  neutral: '→',
};

// PI-0011A: exported so Portfolio Mission Control can reuse the exact same
// card renderer for its own "Top Priority" section (a single-item list)
// instead of re-implementing the score/tier/impact/reason card markup.
export function PriorityRankedList({
  items,
  th,
  title,
}: {
  items: PrioritizedObjective[];
  th: typeof THEMES[Theme];
  title?: string;
}) {
  return (
    <div>
      {title && <h3 className={`mb-1.5 text-[10px] uppercase tracking-widest ${th.textFaint}`}>{title}</h3>}
      <div className="space-y-2">
        {items.map(({ objective, score, tier, reasons }) => {
          const tierStyle = TIER_STYLE[tier];
          const impact = objective.portfolioImpact;
          return (
            <div key={objective.id} className={`rounded-xl border ${th.border} ${th.card} p-3`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className={`text-[12px] font-bold ${th.text}`}>{objective.title}</p>
                  <p className={`mt-0.5 text-[11px] ${th.textMuted}`}>{objective.summary}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${tierStyle.border} ${tierStyle.bg} ${tierStyle.text}`}>
                    {tier}
                  </span>
                  <span className={`text-[13px] font-bold ${th.text}`} title="Priority Score">{score}</span>
                </div>
              </div>

              <div className="mt-2 flex items-baseline gap-2">
                <span className={`text-[9px] uppercase tracking-widest ${th.textFaint}`}>Expected Portfolio Impact</span>
                <span className={`text-[11px] font-semibold ${impact.direction === 'positive' ? 'text-emerald-400' : impact.direction === 'negative' ? 'text-red-400' : th.textMuted}`}>
                  {IMPACT_DIRECTION_ARROW[impact.direction]} {impact.magnitude}
                  {impact.estimatedDollarValue != null ? ` (~$${Math.abs(impact.estimatedDollarValue).toFixed(0)})` : ''}
                </span>
              </div>
              {impact.explanation && <p className={`mt-0.5 text-[10px] ${th.textFaint}`}>{impact.explanation}</p>}

              {reasons.length > 0 && (
                <div className="mt-2">
                  <span className={`text-[9px] uppercase tracking-widest ${th.textFaint}`}>Reason</span>
                  <ul className="mt-0.5 space-y-0.5">
                    {reasons.map((reason) => (
                      <li key={reason} className={`text-[10px] ${th.textMuted}`}>&bull; {reason}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

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
          <PriorityRankedList items={immediateAction} th={th} title="Immediate Action" />
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
              <PriorityRankedList items={reviewToday.earningsReviews} th={th} title="Earnings Reviews" />
            )}
            {reviewToday.expiringPositions.length > 0 && (
              <PriorityRankedList items={reviewToday.expiringPositions} th={th} title="Expiring Positions" />
            )}
            {reviewToday.mediumPriority.length > 0 && (
              <PriorityRankedList items={reviewToday.mediumPriority} th={th} title="Medium Priority" />
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
              <PriorityRankedList items={opportunities.rollOpportunities} th={th} title="Roll Opportunities" />
            )}
            {opportunities.cspOpportunities.length > 0 && (
              <PriorityRankedList items={opportunities.cspOpportunities} th={th} title="CSP Opportunities" />
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
