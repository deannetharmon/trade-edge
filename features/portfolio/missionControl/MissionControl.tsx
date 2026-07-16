// features/portfolio/missionControl/MissionControl.tsx
//
// PI-0011A: Portfolio Mission Control -- the new primary landing view for
// the Portfolio section. This component evaluates and computes nothing new;
// it orchestrates five already-existing outputs into one page:
//
//   1. Portfolio Summary  -- derivePortfolioSummary() (PI-0004D,
//      features/portfolio/briefing/portfolioSummary.ts), reused verbatim.
//   2. Top Priority        -- selectTopPriority() (PI-0011A,
//      lib/todaysPriorities), which itself only picks the highest-scoring
//      head off buckets PI-0010A/B already built and sorted; rendered with
//      the same <PriorityRankedList> card PI-0010B already built.
//   3. Today's Work Queue  -- the full, unmodified <TodaysPrioritiesDashboard>
//      component from PI-0010A/B, reused wholesale.
//   4. Portfolio Health    -- derivePortfolioHealth() (PI-0004D,
//      features/portfolio/briefing/portfolioHealth.ts), reused verbatim,
//      same status banner styling as the Daily Portfolio Briefing.
//   5. Opportunity Summary -- a compact count readout over the same
//      `dashboard.opportunities` object Today's Work Queue already renders
//      in full detail below it.
//
// Nothing here re-ranks, re-scores, or re-evaluates a position, and no
// Position Intelligence or Decision Engine call is made from this file --
// every prop is data the Portfolio page already computed for its other
// tabs (Briefing, Today's Priorities).

'use client';

import { THEMES, Theme } from '@/lib/theme';
import type { PortfolioObjective } from '@/lib/portfolio-intelligence';
import type { TodaysPrioritiesDashboard as TodaysPrioritiesDashboardData, PrioritizedObjective } from '@/lib/todaysPriorities';
import { TodaysPrioritiesDashboard, PriorityRankedList } from '../dashboard/TodaysPrioritiesDashboard';
import { derivePortfolioHealth, type PortfolioHealthLevel } from '../briefing/portfolioHealth';
import { derivePortfolioSummary } from '../briefing/portfolioSummary';

const HEALTH_STYLE: Record<PortfolioHealthLevel, { border: string; bg: string; text: string }> = {
  healthy: { border: 'border-emerald-600/50', bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
  attention: { border: 'border-amber-600/50', bg: 'bg-amber-500/10', text: 'text-amber-400' },
  action: { border: 'border-red-600/50', bg: 'bg-red-500/10', text: 'text-red-400' },
};

function SectionHeader({ label, th }: { label: string; th: typeof THEMES[Theme] }) {
  return <h2 className={`mb-2 text-[12px] font-bold uppercase tracking-widest ${th.text}`}>{label}</h2>;
}

function EmptyState({ label, th }: { label: string; th: typeof THEMES[Theme] }) {
  return (
    <div className={`rounded-xl border ${th.borderLight} ${th.card} p-4 text-center`}>
      <p className={`text-[11px] ${th.textFaint}`}>{label}</p>
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

export interface MissionControlProps {
  // The full canonical objective list (same one the Briefing tab already
  // consumes) -- feeds Portfolio Summary and Portfolio Health only. `null`
  // means Portfolio Intelligence hasn't computed anything yet.
  objectives: PortfolioObjective[] | null;
  // PI-0010A/B's already-built dashboard -- feeds Today's Work Queue and
  // Opportunity Summary directly, and is what selectTopPriority() read to
  // produce `topPriority` below.
  dashboard: TodaysPrioritiesDashboardData;
  topPriority: PrioritizedObjective | null;
  loading: boolean;
  th: typeof THEMES[Theme];
}

export function MissionControl({ objectives, dashboard, topPriority, loading, th }: MissionControlProps) {
  if (objectives === null && loading) {
    return (
      <div className="mx-6 mt-4">
        <div className={`rounded-xl border ${th.border} ${th.card} p-6 text-center`}>
          <p className={`text-[11px] ${th.textFaint}`}>Loading Mission Control&hellip;</p>
        </div>
      </div>
    );
  }

  const health = derivePortfolioHealth(objectives);
  const healthStyle = HEALTH_STYLE[health.level];
  const summary = derivePortfolioSummary(objectives);
  const { opportunities } = dashboard;

  return (
    <div className="mx-6 mt-4 mb-8 space-y-8" aria-label="Portfolio Mission Control">
      {/* 1. Portfolio Summary */}
      <section aria-label="Portfolio Summary">
        <SectionHeader label="Portfolio Summary" th={th} />
        <ul className={`space-y-1 rounded-xl border ${th.border} ${th.card} p-4`}>
          {summary.map((line) => (
            <li key={line} className={`text-[12px] ${th.textMuted}`}>{line}</li>
          ))}
        </ul>
      </section>

      {/* 2. Top Priority */}
      <section aria-label="Top Priority">
        <SectionHeader label="Top Priority" th={th} />
        {topPriority ? (
          <PriorityRankedList items={[topPriority]} th={th} />
        ) : (
          <EmptyState label="Nothing urgent enough to lead with right now." th={th} />
        )}
      </section>

      {/* 3. Today's Work Queue */}
      <section aria-label="Today's Work Queue">
        <SectionHeader label="Today's Work Queue" th={th} />
        <TodaysPrioritiesDashboard dashboard={dashboard} th={th} />
      </section>

      {/* 4. Portfolio Health */}
      <section aria-label="Portfolio Health">
        <SectionHeader label="Portfolio Health" th={th} />
        <div className={`flex items-center gap-3 rounded-xl border p-4 ${healthStyle.border} ${healthStyle.bg}`}>
          <span className="text-2xl leading-none" aria-hidden="true">{health.emoji}</span>
          <p className={`text-sm font-bold tracking-wide ${healthStyle.text}`}>{health.label}</p>
        </div>
      </section>

      {/* 5. Opportunity Summary */}
      <section aria-label="Opportunity Summary">
        <SectionHeader label="Opportunity Summary" th={th} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <OpportunityStat label="Roll" count={opportunities.rollOpportunities.length} th={th} />
          <OpportunityStat label="Covered Call" count={opportunities.coveredCallOpportunities.length} th={th} />
          <OpportunityStat label="CSP" count={opportunities.cspOpportunities.length} th={th} />
          <OpportunityStat label="Screener" count={opportunities.screenerCandidatesAvailable ? 1 : 0} th={th} />
        </div>
      </section>
    </div>
  );
}
