// features/portfolio/briefing/DailyPortfolioBriefing.tsx
//
// WA-0004: Briefing's single canonical composition -- "what changed, why
// does it matter, and what should I understand before acting?" This
// component evaluates and computes nothing of its own. Every section below
// is a direct render of an already-computed, canonical output:
//
//   - Portfolio Health         <- PortfolioReviewSnapshot.currentState.health,
//                                 via buildDailyBriefing()'s snapshot (never
//                                 the retired bespoke 3-bucket derivation)
//   - Executive Summary /
//     Portfolio Snapshot /
//     Upcoming Events          <- buildDailyBriefing() (lib/dailyBriefing),
//                                 relocated here from Positions' now-removed
//                                 transitional DailyBriefingCard
//   - Since Your Last Review   <- ReviewNarrative.sinceLastReview, via
//                                 conductReview() (lib/review-conductor),
//                                 relocated here from Mission Control, gated
//                                 on the shared TRADER_COMMITMENT_TRACKING_ACTIVE
//                                 flag (lib/review-conductor/trackingStatus.ts)
//                                 so this surface can never present "tracking
//                                 is unwired" as "tracking ran and found
//                                 nothing" -- see that module's doc.
//   - Contextual/Newly-         <- buildDailyBriefing().risks, unfiltered:
//     Intensified Risks            every risk here already renders with no
//                                   completion control (mirrors the retired
//                                   DailyBriefingCard's dormant "Current
//                                   Risks" section verbatim); a risk whose
//                                   underlying condition is already
//                                   actionable elsewhere still renders here
//                                   as context only (CES section 8).
//   - Suggested Focus          <- deriveSuggestedFocus() (unchanged, this
//                                 sprint does not touch it)
//
// This component calls conductReview() for the first time from /portfolio
// (previously only /dashboard's buildMissionControlViewModel() did),
// mirroring that exact call pattern -- same hardcoded revalidationResults:
// [] placeholder input, same reasoning (no Trader Commitment persistence is
// wired to any page; building that persistence remains out of this sprint's
// scope, see trackingStatus.ts).
//
// Explicitly NOT rendered here: the legacy Priority List
// (TodaysPrioritiesWorkflow, Mark Complete/Reopen included -- it already has
// its own tab, `priorities`, unmodified), and Current Opportunities
// (discovery-of-new-trade content, WA-0005's concern).

'use client';

import { useMemo } from 'react';
import { THEMES, Theme } from '@/lib/theme';
import type { PortfolioObjective } from '@/lib/portfolio-intelligence';
import type { DailyBriefing, RiskKind, UpcomingEventKind } from '@/lib/dailyBriefing';
import type { PortfolioHealthStatus } from '@/lib/portfolioHealth';
import type { PortfolioReviewSnapshot } from '@/lib/portfolioReview';
import type { TodaysPrioritiesDashboard } from '@/lib/todaysPriorities';
import { buildAttentionFeed } from '@/lib/morning-briefing';
import { conductReview, TRADER_COMMITMENT_TRACKING_ACTIVE } from '@/lib/review-conductor';
import { deriveSuggestedFocus } from './suggestedFocus';

export interface DailyPortfolioBriefingProps {
  objectives: PortfolioObjective[] | null;
  // Canonical producer output (lib/dailyBriefing), already computed by the
  // page's own composition -- never recomputed here.
  dailyBriefing: DailyBriefing | null;
  // Needed only to call conductReview() for "Since Your Last Review" --
  // already computed by the page's own composition, never recomputed here.
  portfolioReview: PortfolioReviewSnapshot | null;
  todaysPrioritiesDashboard: TodaysPrioritiesDashboard | null;
  loading: boolean;
  th: typeof THEMES[Theme];
}

const HEALTH_STATUS_STYLE: Record<PortfolioHealthStatus, { border: string; bg: string; text: string; emoji: string }> = {
  Healthy: { border: 'border-emerald-600/50', bg: 'bg-emerald-500/10', text: 'text-emerald-400', emoji: '\u{1F7E2}' },
  'Needs Attention': { border: 'border-amber-600/50', bg: 'bg-amber-500/10', text: 'text-amber-400', emoji: '\u{1F7E1}' },
  'Action Required': { border: 'border-red-600/50', bg: 'bg-red-500/10', text: 'text-red-400', emoji: '\u{1F534}' },
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

function SectionHeader({ label, th }: { label: string; th: typeof THEMES[Theme] }) {
  return <h2 className={`mb-2 text-[11px] font-bold uppercase tracking-widest ${th.textFaint}`}>{label}</h2>;
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

export function DailyPortfolioBriefing({
  objectives,
  dailyBriefing,
  portfolioReview,
  todaysPrioritiesDashboard,
  loading,
  th,
}: DailyPortfolioBriefingProps) {
  // WA-0004: the first /portfolio call site for conductReview() -- mirrors
  // lib/mission-control/buildMissionControlViewModel.ts's exact call
  // pattern (same hardcoded revalidationResults: [] placeholder, same
  // reasoning: no Trader Commitment persistence is wired anywhere yet).
  const narrative = useMemo(() => {
    if (!portfolioReview || !todaysPrioritiesDashboard) return null;
    const generatedAt = new Date().toISOString();
    const attentionFeed = buildAttentionFeed({ dashboard: todaysPrioritiesDashboard, generatedAt });
    return conductReview({
      generatedAt,
      portfolioReview,
      attentionFeed,
      opportunities: [],
      // See lib/review-conductor/trackingStatus.ts's module doc -- no
      // commitment store is wired to any page yet. This is not a stand-in
      // for "nothing changed"; see TRADER_COMMITMENT_TRACKING_ACTIVE below,
      // which is what actually gates this section's rendered copy.
      revalidationResults: [],
    });
  }, [portfolioReview, todaysPrioritiesDashboard]);

  if (dailyBriefing === null) {
    if (loading) {
      return (
        <section className="mx-6 mt-4" aria-label="Daily Portfolio Briefing">
          <div className={`rounded-xl border ${th.border} ${th.card} p-6 text-center`} role="status">
            <p className={`text-[11px] ${th.textFaint}`}>Loading Today&rsquo;s Briefing&hellip;</p>
          </div>
        </section>
      );
    }
    // WA-0004 corrective round: dailyBriefing composes to null exactly when
    // portfolioReview does (lib/portfolio-intelligence/dashboardComposition.ts),
    // which happens exactly when there are zero positions, zero pending
    // orders, and no canonical priorities -- i.e. there is no portfolio data
    // to summarize yet, not "everything is fine." Never render nothing here
    // and never imply a health/change/risk conclusion that wasn't computed --
    // the Briefing landmark and its accessible label are preserved even in
    // this empty state (CES section 14/15).
    return (
      <section className="mx-6 mt-4" aria-label="Daily Portfolio Briefing">
        <div className={`rounded-xl border ${th.borderLight} ${th.card} p-6 text-center`}>
          <p className={`text-[11px] ${th.textFaint}`}>No briefing available right now.</p>
          <p className={`mt-1 text-[11px] ${th.textFaint}`}>There is no portfolio data or open positions to summarize.</p>
        </div>
      </section>
    );
  }

  const healthStyle = HEALTH_STATUS_STYLE[dailyBriefing.snapshot.healthStatus];
  const focus = deriveSuggestedFocus(objectives);
  const changes = narrative?.sinceLastReview.changes ?? [];

  return (
    <div className="mx-6 mt-4 mb-8 space-y-6" aria-label="Daily Portfolio Briefing">
      {/* 1. Portfolio Health -- canonical score/status only. */}
      <section
        aria-label="Portfolio Health"
        className={`flex items-center gap-3 rounded-xl border p-4 ${healthStyle.border} ${healthStyle.bg}`}
      >
        <span className="text-2xl leading-none" aria-hidden="true">{healthStyle.emoji}</span>
        <div>
          <p className={`text-sm font-bold tracking-wide ${healthStyle.text}`}>{dailyBriefing.snapshot.healthStatus}</p>
          <p className={`text-[11px] ${th.textFaint}`}>Score {dailyBriefing.snapshot.healthScore}</p>
        </div>
      </section>

      {/* 2. Executive Summary */}
      <section aria-label="Executive Summary">
        <SectionHeader label="Executive Summary" th={th} />
        <div className={`rounded-xl border p-4 ${healthStyle.border} ${healthStyle.bg}`}>
          <p className={`text-[13px] font-semibold leading-relaxed ${healthStyle.text}`}>{dailyBriefing.executiveSummary}</p>
        </div>
      </section>

      {/* 3. Portfolio Snapshot */}
      <section aria-label="Portfolio Snapshot">
        <SectionHeader label="Portfolio Snapshot" th={th} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <SnapshotStat label="Health Score" value={String(dailyBriefing.snapshot.healthScore)} th={th} />
          <SnapshotStat label="Health Status" value={dailyBriefing.snapshot.healthStatus} th={th} />
          <SnapshotStat label="Open Positions" value={String(dailyBriefing.snapshot.openPositionCount)} th={th} />
          <SnapshotStat
            label="Capital Deployment"
            value={dailyBriefing.snapshot.capitalDeploymentPct != null ? `${dailyBriefing.snapshot.capitalDeploymentPct.toFixed(0)}%` : 'N/A'}
            th={th}
          />
          <SnapshotStat
            label="Largest Concentration"
            value={dailyBriefing.snapshot.largestConcentrationPct != null ? `${dailyBriefing.snapshot.largestConcentrationPct.toFixed(1)}%` : 'N/A'}
            th={th}
          />
          <SnapshotStat
            label="Avg. Position Health"
            value={dailyBriefing.snapshot.averagePositionHealth != null ? String(Math.round(dailyBriefing.snapshot.averagePositionHealth)) : 'N/A'}
            th={th}
          />
        </div>
      </section>

      {/* 4. Since Your Last Review -- gated on the shared
          TRADER_COMMITMENT_TRACKING_ACTIVE flag (lib/review-conductor),
          the identical flag + narrative Mission Control's compact summary
          reads, so the two surfaces can never disagree about which of the
          three states applies. */}
      <section aria-label="Since Your Last Review">
        <SectionHeader label="Since Your Last Review" th={th} />
        <div className={`rounded-xl border ${th.border} ${th.card} p-4`}>
          {!TRADER_COMMITMENT_TRACKING_ACTIVE ? (
            <p className={`text-[12px] ${th.textFaint}`} role="status">Change tracking is not yet active.</p>
          ) : changes.length === 0 ? (
            <p className={`text-[12px] ${th.textFaint}`}>Nothing changed since your last review.</p>
          ) : (
            <ul className="space-y-3">
              {changes.map((result) => (
                <li key={result.commitment.id} className={`border-l-2 ${th.borderLight} pl-3`}>
                  <p className={`text-[12px] font-semibold ${th.text}`}>{result.commitment.subject.label}</p>
                  {result.change && (
                    <>
                      <p className={`mt-0.5 text-[12px] ${th.textMuted}`}>{result.change.whatChanged}</p>
                      <p className={`mt-0.5 text-[11px] ${th.textFaint}`}>{result.change.whyItMatters}</p>
                      <p className={`mt-0.5 text-[11px] ${th.textFaint}`}>{result.change.whyNow}</p>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* 5. Upcoming Events */}
      <section aria-label="Upcoming Events">
        <SectionHeader label="Upcoming Events" th={th} />
        {dailyBriefing.upcomingEvents.length > 0 ? (
          <ul className="space-y-1">
            {dailyBriefing.upcomingEvents.map((e) => (
              <li key={e.id} className={`rounded-lg border ${th.borderLight} ${th.card} px-3 py-2 text-[11px] ${th.textMuted}`}>
                <span className={`mr-2 text-[9px] font-bold uppercase tracking-widest ${th.textFaint}`}>{UPCOMING_EVENT_LABEL[e.kind]}</span>
                <span className={`font-bold ${th.text}`}>{e.label}</span> &mdash; {e.detail}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState label="No upcoming events right now." th={th} />
        )}
      </section>

      {/* 6. Contextual / Newly-Intensified Risks -- the full
          buildDailyBriefing().risks list, unfiltered, rendered with no
          completion control (never has been -- see DailyBriefingCard's
          retired "Current Risks" section, which this replaces verbatim).
          A risk whose underlying condition already has a queue-eligible
          objective still renders here as context only (CES section 8). */}
      <section aria-label="Contextual Risks">
        <SectionHeader label="Contextual Risks" th={th} />
        {dailyBriefing.risks.length > 0 ? (
          <ul className="space-y-1">
            {dailyBriefing.risks.map((r) => (
              <li key={r.id} className={`rounded-lg border ${th.borderLight} ${th.card} px-3 py-2 text-[11px] ${th.textMuted}`}>
                <span className={`mr-2 text-[9px] font-bold uppercase tracking-widest ${th.textFaint}`}>{RISK_KIND_LABEL[r.kind]}</span>
                <span className={`font-bold ${th.text}`}>{r.label}</span> &mdash; {r.detail}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState label="No active risks right now." th={th} />
        )}
      </section>

      {/* 7. Suggested Focus -- retained, unchanged. */}
      <section aria-label="Suggested Focus">
        <SectionHeader label="Suggested Focus" th={th} />
        <div className={`rounded-xl border ${th.border} ${th.card} p-4`}>
          <p className={`text-[13px] font-semibold ${th.text}`}>{focus}</p>
        </div>
      </section>
    </div>
  );
}
