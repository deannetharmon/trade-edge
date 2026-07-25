// features/portfolio/dailyBriefing/DailyBriefingCard.tsx
//
// PI-0013: Daily Briefing Dashboard UI.
//
// Renders lib/dailyBriefing's already-composed DailyBriefing model as the
// first card on the Portfolio page, above the Portfolio Review card. This
// component evaluates and computes nothing: Today's Priorities reuses the
// exact same <PriorityRankedList> Portfolio Review and Mission Control
// already render (fed Portfolio Review's own already-scored Top Risks,
// unchanged); every other section is a plain read of already-composed
// counts/labels/strings. No new score, no new recommendation, no re-ranking,
// no AI-generated text.
//
// Deliberately not another Portfolio Review -- this card answers "what do I
// need to know before I make a trading decision today" in under 30 seconds;
// Portfolio Review (rendered directly below this card) remains the more
// detailed, browsable breakdown.
//
// WA-0002: `variant` prop added. Default `'full'` is this card's original,
// unchanged behavior (all six sections). `'transitional'` renders only
// Executive Summary, Portfolio Snapshot, and Upcoming Events, plus a visible
// "temporary" label -- used on the Positions tab so Briefing-owned content
// with no equivalent destination until WA-0004 remains visible to the
// trader rather than silently disappearing when Today's Priorities/
// Opportunities/Risks are removed from Positions (all three are already
// fully owned elsewhere). No new data is fetched and no lib/dailyBriefing
// function changes for either variant -- this is conditional rendering of
// sections that already exist.

'use client';

import { THEMES, Theme } from '@/lib/theme';
import type { DailyBriefing, OpportunityKind, RiskKind, UpcomingEventKind } from '@/lib/dailyBriefing';
import type { PortfolioHealthStatus } from '@/lib/portfolioHealth';
import { PriorityRankedList } from '../dashboard/TodaysPrioritiesDashboard';

const HEALTH_STATUS_STYLE: Record<PortfolioHealthStatus, { border: string; bg: string; text: string }> = {
  Healthy: { border: 'border-emerald-600/50', bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
  'Needs Attention': { border: 'border-amber-600/50', bg: 'bg-amber-500/10', text: 'text-amber-400' },
  'Action Required': { border: 'border-red-600/50', bg: 'bg-red-500/10', text: 'text-red-400' },
};

const UPCOMING_EVENT_LABEL: Record<UpcomingEventKind, string> = {
  dte: 'Management Window',
  earnings: 'Earnings',
  decision_review_follow_up: 'Follow-Up',
};

const RISK_KIND_LABEL: Record<RiskKind, string> = {
  concentration: 'Concentration',
  capital: 'Capital',
  assignment_exposure: 'Assignment Exposure',
  earnings_exposure: 'Earnings Exposure',
  immediate_attention: 'Immediate Attention',
};

const OPPORTUNITY_KIND_LABEL: Record<OpportunityKind, string> = {
  roll: 'Roll',
  covered_call: 'Covered Call',
  csp: 'CSP',
  screener: 'Screener',
};

function SectionHeader({ label, th }: { label: string; th: typeof THEMES[Theme] }) {
  return <h3 className={`mb-2 text-[11px] font-bold uppercase tracking-widest ${th.textFaint}`}>{label}</h3>;
}

function EmptyState({ label, th }: { label: string; th: typeof THEMES[Theme] }) {
  return (
    <div className={`rounded-lg border ${th.borderLight} ${th.card} p-3 text-center`}>
      <p className={`text-[11px] ${th.textFaint}`}>{label}</p>
    </div>
  );
}

function SnapshotStat({ label, value, th }: { label: string; value: string; th: typeof THEMES[Theme] }) {
  return (
    <div className={`rounded-lg border ${th.borderLight} ${th.card} px-3 py-2`}>
      <p className={`text-[9px] uppercase tracking-widest ${th.textFaint}`}>{label}</p>
      <p className={`mt-0.5 text-[13px] font-bold ${th.text}`}>{value}</p>
    </div>
  );
}

function OpportunityStat({ label, count, th }: { label: string; count: number; th: typeof THEMES[Theme] }) {
  return (
    <div className={`rounded-lg border ${th.borderLight} ${th.card} px-4 py-3 text-center`}>
      <p className={`text-xl font-bold ${count > 0 ? th.text : th.textFaint}`}>{count}</p>
      <p className={`mt-0.5 text-[9px] uppercase tracking-widest ${th.textFaint}`}>{label}</p>
    </div>
  );
}

export interface DailyBriefingCardProps {
  // `null` means the briefing hasn't been composed yet (e.g. balances/
  // positions not loaded) -- distinct from an empty portfolio, which is a
  // valid, cleanly-rendered briefing with zero of everything.
  briefing: DailyBriefing | null;
  loading: boolean;
  th: typeof THEMES[Theme];
  // WA-0002: 'full' (default) is this card's original, unchanged behavior.
  // 'transitional' renders only Executive Summary/Portfolio Snapshot/
  // Upcoming Events plus a temporary-content label -- see module doc.
  variant?: 'full' | 'transitional';
}

export function DailyBriefingCard({ briefing, loading, th, variant = 'full' }: DailyBriefingCardProps) {
  if (briefing === null) {
    if (!loading) return null;
    return (
      <section className="mb-6" aria-label="Today's Briefing">
        <div className={`rounded-xl border ${th.border} ${th.card} p-6 text-center`}>
          <p className={`text-[11px] ${th.textFaint}`}>Loading Today&rsquo;s Briefing&hellip;</p>
        </div>
      </section>
    );
  }

  const healthStyle = HEALTH_STATUS_STYLE[briefing.snapshot.healthStatus];
  const isTransitional = variant === 'transitional';

  return (
    <section className={`mb-6 rounded-xl border ${th.border} ${th.card} p-4 space-y-5`} aria-label="Today's Briefing">
      <h2 className={`text-[12px] font-bold uppercase tracking-widest ${th.text}`}>Today&rsquo;s Briefing</h2>

      {/* WA-0002: transitional-variant label -- this content has no
          equivalent destination on Positions until WA-0004 ships the
          Briefing workspace; scheduled for removal from Positions then. */}
      {isTransitional && (
        <p
          className="rounded-lg border border-amber-600/50 bg-amber-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-amber-400"
          aria-label="Transitional Content Notice"
        >
          Temporary &mdash; moving to Briefing in WA-0004
        </p>
      )}

      {/* 1. Executive Summary */}
      <div aria-label="Executive Summary">
        <SectionHeader label="Executive Summary" th={th} />
        <div className={`rounded-xl border p-4 ${healthStyle.border} ${healthStyle.bg}`}>
          <p className={`text-[13px] font-semibold leading-relaxed ${healthStyle.text}`}>{briefing.executiveSummary}</p>
        </div>
      </div>

      {/* 2. Today's Priorities -- same <PriorityRankedList> Portfolio Review
          and Mission Control already render, fed Portfolio Review's own
          already-scored/limited Top Risks. Nothing re-ranked here.
          Not rendered in the transitional variant: already fully owned by
          Mission Control / Today's Priorities. */}
      {!isTransitional && (
      <div aria-label="Today's Priorities">
        <SectionHeader label="Today's Priorities" th={th} />
        {briefing.priorities.length > 0 ? (
          <PriorityRankedList items={briefing.priorities} th={th} />
        ) : (
          <EmptyState label="Nothing urgent enough to lead with right now." th={th} />
        )}
      </div>
      )}

      {/* 3. Portfolio Snapshot -- direct reads of already-computed values. */}
      <div aria-label="Portfolio Snapshot">
        <SectionHeader label="Portfolio Snapshot" th={th} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <SnapshotStat label="Health Score" value={String(briefing.snapshot.healthScore)} th={th} />
          <SnapshotStat label="Health Status" value={briefing.snapshot.healthStatus} th={th} />
          <SnapshotStat label="Open Positions" value={String(briefing.snapshot.openPositionCount)} th={th} />
          <SnapshotStat
            label="Capital Deployment"
            value={briefing.snapshot.capitalDeploymentPct != null ? `${briefing.snapshot.capitalDeploymentPct.toFixed(0)}%` : 'N/A'}
            th={th}
          />
          <SnapshotStat
            label="Largest Concentration"
            value={briefing.snapshot.largestConcentrationPct != null ? `${briefing.snapshot.largestConcentrationPct.toFixed(1)}%` : 'N/A'}
            th={th}
          />
          <SnapshotStat
            label="Avg. Position Health"
            value={briefing.snapshot.averagePositionHealth != null ? String(Math.round(briefing.snapshot.averagePositionHealth)) : 'N/A'}
            th={th}
          />
        </div>
      </div>

      {/* 4. Upcoming Events */}
      <div aria-label="Upcoming Events">
        <SectionHeader label="Upcoming Events" th={th} />
        {briefing.upcomingEvents.length > 0 ? (
          <ul className="space-y-1">
            {briefing.upcomingEvents.map((e) => (
              <li key={e.id} className={`rounded-lg border ${th.borderLight} ${th.card} px-3 py-2 text-[11px] ${th.textMuted}`}>
                <span className={`mr-2 text-[9px] font-bold uppercase tracking-widest ${th.textFaint}`}>{UPCOMING_EVENT_LABEL[e.kind]}</span>
                <span className={`font-bold ${th.text}`}>{e.label}</span> &mdash; {e.detail}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState label="No upcoming events right now." th={th} />
        )}
      </div>

      {/* 5. Opportunity Summary -- identical stat-card style to Mission
          Control's own Opportunity Summary section. Not rendered in the
          transitional variant: already fully owned by Today's Priorities. */}
      {!isTransitional && (
      <div aria-label="Current Opportunities">
        <SectionHeader label="Current Opportunities" th={th} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {briefing.opportunities.map((o) => (
            <OpportunityStat key={o.kind} label={OPPORTUNITY_KIND_LABEL[o.kind]} count={o.count} th={th} />
          ))}
        </div>
      </div>
      )}

      {/* 6. Risk Summary -- not rendered in the transitional variant. Every
          RiskKind is already fully covered elsewhere: concentration/capital
          on Mission Control's Portfolio Health/Top Risks, immediate_attention
          on Mission Control's Attention Required (same source data,
          dashboard.immediateAction), and assignment_exposure/
          earnings_exposure as position-card risk badges (WA-0002,
          PositionRiskBadges). See
          docs/design/WA-0002-Positions-Legacy-Mission-Control-CES.md
          Section 8 for the evidence behind each. */}
      {!isTransitional && (
      <div aria-label="Current Risks">
        <SectionHeader label="Current Risks" th={th} />
        {briefing.risks.length > 0 ? (
          <ul className="space-y-1">
            {briefing.risks.map((r) => (
              <li key={r.id} className={`rounded-lg border ${th.borderLight} ${th.card} px-3 py-2 text-[11px] ${th.textMuted}`}>
                <span className={`mr-2 text-[9px] font-bold uppercase tracking-widest ${th.textFaint}`}>{RISK_KIND_LABEL[r.kind]}</span>
                <span className={`font-bold ${th.text}`}>{r.label}</span> &mdash; {r.detail}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState label="No active risks right now." th={th} />
        )}
      </div>
      )}
    </section>
  );
}
