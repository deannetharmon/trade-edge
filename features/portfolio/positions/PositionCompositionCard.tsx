// features/portfolio/positions/PositionCompositionCard.tsx
//
// WA-0002: Portfolio Composition, extracted from PI-0012A's
// PortfolioReviewCard.tsx onto Positions under a name that matches what it
// actually shows. This component evaluates and computes nothing -- it is a
// direct, unmodified copy of PortfolioReviewCard's former "Portfolio
// Composition" section, reading the exact same already-composed
// PortfolioReviewSnapshot.composition fields.
//
// Deliberately excludes currentState.concentrationConcerns (portfolio-wide
// risk, not a composition fact -- owned by Mission Control, per WA-0001's
// matrix) and everything else PortfolioReviewCard used to render (Portfolio
// Health, Top Risks, Capital & Income), all of which are already fully
// duplicated on Mission Control (/dashboard). See
// docs/design/WA-0002-Positions-Legacy-Mission-Control-CES.md Section 7.

'use client';

import { THEMES, Theme } from '@/lib/theme';
import type { PortfolioReviewSnapshot } from '@/lib/portfolioReview';

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

export interface PositionCompositionCardProps {
  // `null` means the Portfolio Review snapshot (and therefore composition)
  // hasn't been composed yet -- distinct from an empty portfolio, which is a
  // valid, cleanly-rendered snapshot with zero positions.
  review: PortfolioReviewSnapshot | null;
  loading: boolean;
  th: typeof THEMES[Theme];
}

export function PositionCompositionCard({ review, loading, th }: PositionCompositionCardProps) {
  if (review === null) {
    if (!loading) return null;
    return (
      <section className="mb-6" aria-label="Portfolio Composition">
        <div className={`rounded-xl border ${th.border} ${th.card} p-6 text-center`}>
          <p className={`text-[11px] ${th.textFaint}`}>Loading Portfolio Composition&hellip;</p>
        </div>
      </section>
    );
  }

  const { composition } = review;

  return (
    <section className={`mb-6 rounded-xl border ${th.border} ${th.card} p-4`} aria-label="Portfolio Composition">
      <h2 className={`mb-3 text-[12px] font-bold uppercase tracking-widest ${th.text}`}>Portfolio Composition</h2>

      <SectionHeader label="Composition" th={th} />
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
        </div>
      )}
    </section>
  );
}
