// components/mission-control/PortfolioStatusSection.tsx
//
// MB-0002: narrative section 1, Portfolio Status -- the full-detail version
// of what SummaryStrip already previewed at the top of the page. Pure
// presentation over PortfolioReviewSnapshot (PI-0012A); renders every field
// as-is, computes nothing.

import type { THEMES, Theme } from '@/lib/theme';
import type { PortfolioReviewSnapshot } from '@/lib/portfolioReview';

export interface PortfolioStatusSectionProps {
  review: PortfolioReviewSnapshot;
  th: (typeof THEMES)[Theme];
}

export function PortfolioStatusSection({ review, th }: PortfolioStatusSectionProps) {
  const { currentState, composition } = review;
  const concerns = [...currentState.concentrationConcerns, ...currentState.capitalConcerns];

  return (
    <section aria-label="Portfolio Status" className={`mb-6 rounded-xl border ${th.border} ${th.card} p-4`}>
      <h2 className={`mb-3 text-[12px] font-bold uppercase tracking-widest ${th.text}`}>Portfolio Status</h2>

      {currentState.topRisks.length > 0 ? (
        <ul className="mb-3 space-y-1">
          {currentState.topRisks.map((risk) => (
            <li key={risk.objective.id} className={`text-[12px] ${th.textMuted}`}>
              <span className={`font-semibold ${th.text}`}>{risk.objective.title}</span>
              <span className={`ml-2 text-[10px] uppercase tracking-wide ${th.textFaint}`}>{risk.tier}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={`mb-3 text-[12px] ${th.textFaint}`}>No standout risks in your book today.</p>
      )}

      {concerns.length > 0 ? (
        <ul className="mb-3 space-y-1">
          {concerns.map((concern) => (
            <li key={concern.id} className={`text-[11px] ${th.textFaint}`}>{concern.title}</li>
          ))}
        </ul>
      ) : (
        <p className={`mb-3 text-[11px] ${th.textFaint}`}>No concentration or capital concerns today.</p>
      )}

      {currentState.incomeConcern && (
        <p className={`mb-3 text-[11px] ${th.textFaint}`}>{currentState.incomeConcern.title}</p>
      )}

      <p className={`text-[10px] ${th.textFaint}`}>
        {composition.positionCount} open {composition.positionCount === 1 ? 'position' : 'positions'}
        {composition.maxSymbolConcentrationPct != null && (
          <> &middot; largest single-symbol concentration {composition.maxSymbolConcentrationPct.toFixed(0)}%</>
        )}
      </p>
    </section>
  );
}
