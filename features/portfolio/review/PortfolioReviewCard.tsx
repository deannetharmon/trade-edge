// features/portfolio/review/PortfolioReviewCard.tsx
//
// PI-0012A: Portfolio Review, Phase 1 -- Composition Layer UI.
//
// Renders lib/portfolioReview's already-composed PortfolioReviewSnapshot as
// the first card on the existing Portfolio page, above the position list.
// This component evaluates and computes nothing: Portfolio Health is
// MissionControl.tsx's own Portfolio Health section, reused with identical
// markup; Top Risks reuses the same <PriorityRankedList> Mission Control and
// Today's Priorities already render; Portfolio Composition and Capital &
// Income are plain reads of already-composed fields. No new score, no new
// recommendation, and no re-ranking happens here.
//
// Deliberately not a new top-level tab -- see
// docs/design/PI-0012-Portfolio-Review-Architecture.md's UI Layout Proposal
// for the fuller rationale; this phase places it as a card instead per the
// PI-0012A ticket's explicit UI Placement constraint.

'use client';

import { THEMES, Theme } from '@/lib/theme';
import type { PortfolioReviewSnapshot } from '@/lib/portfolioReview';
import type { PortfolioHealthStatus } from '@/lib/portfolioHealth';
import { PriorityRankedList } from '../dashboard/TodaysPrioritiesDashboard';

// Identical palette to MissionControl.tsx's own HEALTH_STATUS_STYLE -- kept
// as a separate copy (rather than importing MissionControl's, which isn't
// exported) so this file has no dependency on that component.
const HEALTH_STATUS_STYLE: Record<PortfolioHealthStatus, { border: string; bg: string; text: string }> = {
  Healthy: { border: 'border-emerald-600/50', bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
  'Needs Attention': { border: 'border-amber-600/50', bg: 'bg-amber-500/10', text: 'text-amber-400' },
  'Action Required': { border: 'border-red-600/50', bg: 'bg-red-500/10', text: 'text-red-400' },
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

function CompositionStat({ label, value, th }: { label: string; value: string; th: typeof THEMES[Theme] }) {
  return (
    <div className={`rounded-lg border ${th.borderLight} ${th.card} px-3 py-2`}>
      <p className={`text-[9px] uppercase tracking-widest ${th.textFaint}`}>{label}</p>
      <p className={`mt-0.5 text-[13px] font-bold ${th.text}`}>{value}</p>
    </div>
  );
}

export interface PortfolioReviewCardProps {
  // `null` means the Portfolio Review snapshot hasn't been composed yet
  // (e.g. balances/positions not loaded) -- distinct from an empty portfolio,
  // which is a valid, cleanly-rendered snapshot with zero positions.
  review: PortfolioReviewSnapshot | null;
  loading: boolean;
  th: typeof THEMES[Theme];
}

export function PortfolioReviewCard({ review, loading, th }: PortfolioReviewCardProps) {
  if (review === null) {
    if (!loading) return null;
    return (
      <section className="mb-6" aria-label="Portfolio Review">
        <div className={`rounded-xl border ${th.border} ${th.card} p-6 text-center`}>
          <p className={`text-[11px] ${th.textFaint}`}>Loading Portfolio Review&hellip;</p>
        </div>
      </section>
    );
  }

  const { currentState, composition } = review;
  const healthStyle = HEALTH_STATUS_STYLE[currentState.health.status];
  const capitalIncomeConcerns = [
    ...currentState.capitalConcerns,
    ...(currentState.incomeConcern ? [currentState.incomeConcern] : []),
  ];

  return (
    <section className={`mb-6 rounded-xl border ${th.border} ${th.card} p-4 space-y-5`} aria-label="Portfolio Review">
      <h2 className={`text-[12px] font-bold uppercase tracking-widest ${th.text}`}>Portfolio Review</h2>

      {/* Portfolio Health -- identical content to MissionControl's own section. */}
      <div aria-label="Portfolio Health">
        <SectionHeader label="Portfolio Health" th={th} />
        <div className={`rounded-xl border p-4 ${healthStyle.border} ${healthStyle.bg}`}>
          <div className="flex items-center gap-3">
            <span className={`text-3xl font-bold leading-none ${healthStyle.text}`}>{currentState.health.score}</span>
            <p className={`text-sm font-bold tracking-wide ${healthStyle.text}`}>{currentState.health.status}</p>
          </div>
          {(currentState.health.positiveContributors.length > 0 || currentState.health.negativeContributors.length > 0) && (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {currentState.health.positiveContributors.length > 0 && (
                <div>
                  <p className={`text-[9px] font-bold uppercase tracking-widest ${th.textFaint}`}>Top Positive Contributors</p>
                  <ul className="mt-1 space-y-0.5">
                    {currentState.health.positiveContributors.map((c) => (
                      <li key={c.id} className={`text-[11px] ${th.textMuted}`}>&bull; {c.label}</li>
                    ))}
                  </ul>
                </div>
              )}
              {currentState.health.negativeContributors.length > 0 && (
                <div>
                  <p className={`text-[9px] font-bold uppercase tracking-widest ${th.textFaint}`}>Top Negative Contributors</p>
                  <ul className="mt-1 space-y-0.5">
                    {currentState.health.negativeContributors.map((c) => (
                      <li key={c.id} className={`text-[11px] ${th.textMuted}`}>&bull; {c.label}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Top Risks -- same <PriorityRankedList> Mission Control renders, fed
          already-scored/sorted entries; nothing is re-ranked here. */}
      <div aria-label="Top Risks">
        <SectionHeader label="Top Risks" th={th} />
        {currentState.topRisks.length > 0 ? (
          <PriorityRankedList items={currentState.topRisks} th={th} />
        ) : (
          <EmptyState label="No elevated risks right now." th={th} />
        )}
      </div>

      {/* Portfolio Composition -- direct aggregation over existing fields. */}
      <div aria-label="Portfolio Composition">
        <SectionHeader label="Portfolio Composition" th={th} />
        {composition.positionCount === 0 ? (
          <EmptyState label="No open positions yet." th={th} />
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <CompositionStat label="Open Positions" value={String(composition.positionCount)} th={th} />
              <CompositionStat
                label="Largest Symbol"
                value={composition.maxSymbolConcentrationPct != null ? `${composition.maxSymbolConcentrationPct.toFixed(1)}%` : 'N/A'}
                th={th}
              />
              <CompositionStat
                label="Wheel-Managed"
                value={composition.wheelManagedFraction != null ? `${(composition.wheelManagedFraction * 100).toFixed(0)}%` : 'N/A'}
                th={th}
              />
              <CompositionStat
                label="Strategies"
                value={String(Object.keys(composition.byStrategy).length)}
                th={th}
              />
            </div>
            <ul className={`flex flex-wrap gap-x-4 gap-y-1 rounded-lg border ${th.borderLight} ${th.card} px-3 py-2`}>
              {Object.entries(composition.byStrategy).map(([strategy, count]) => (
                <li key={strategy} className={`text-[11px] ${th.textMuted}`}>
                  <span className={`font-bold ${th.text}`}>{count}</span> {strategy}
                </li>
              ))}
            </ul>
            {currentState.concentrationConcerns.length > 0 && (
              <ul className="space-y-1">
                {currentState.concentrationConcerns.map((o) => (
                  <li key={o.id} className={`rounded-lg border ${th.borderLight} ${th.card} px-3 py-2 text-[11px] ${th.textMuted}`}>
                    <span className={`font-bold ${th.text}`}>{o.title}</span> &mdash; {o.summary}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Capital & Income -- existing objectives, reused as-is. */}
      <div aria-label="Capital & Income">
        <SectionHeader label="Capital & Income" th={th} />
        {capitalIncomeConcerns.length > 0 ? (
          <ul className="space-y-1">
            {capitalIncomeConcerns.map((o) => (
              <li key={o.id} className={`rounded-lg border ${th.borderLight} ${th.card} px-3 py-2 text-[11px] ${th.textMuted}`}>
                <span className={`font-bold ${th.text}`}>{o.title}</span> &mdash; {o.summary}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState label="No buying power, idle cash, or income concerns right now." th={th} />
        )}
      </div>
    </section>
  );
}
