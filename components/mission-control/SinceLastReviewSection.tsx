// components/mission-control/SinceLastReviewSection.tsx
//
// WA-0004 (CES section 11, corrective ruling): reduced from a full duplicate
// reading experience (every change rendered as a card, whatChanged +
// whyItMatters) to exactly what AttentionRequiredSection's own WA-0003
// reduction already established as this app's pattern for a Mission
// Control summary -- lead text, a count (when meaningful), a one-line
// compact summary, and a single deep link into the surface that now owns
// the full presentation (Briefing, per this CES).
//
// Renders `viewModel.sinceLastReview` exactly as built by
// buildMissionControlViewModel.ts -- this component computes nothing and
// does not independently inspect `changes.length` or the tracking-active
// flag; the three-state distinction (tracking unavailable / tracking active
// with zero changes / tracking active with changes) is already resolved by
// the time this component renders. The full "Since Your Last Review"
// presentation (subject label, whatChanged, whyItMatters, whyNow) now lives
// only in Briefing (features/portfolio/briefing/DailyPortfolioBriefing.tsx).

import type { THEMES, Theme } from '@/lib/theme';
import type { MissionControlSinceLastReviewSummary } from '@/lib/mission-control';

export interface SinceLastReviewSectionProps {
  sinceLastReview: MissionControlSinceLastReviewSummary;
  th: (typeof THEMES)[Theme];
}

export function SinceLastReviewSection({ sinceLastReview, th }: SinceLastReviewSectionProps) {
  const { leadText, count, deepLink } = sinceLastReview;

  return (
    <section aria-label="Since Your Last Review" className={`mb-6 rounded-xl border ${th.border} ${th.card} p-4`}>
      <h2 className={`mb-3 text-[12px] font-bold uppercase tracking-widest ${th.text}`}>Since Your Last Review</h2>

      <p className={`text-[12px] font-semibold ${th.text}`}>{leadText}</p>

      {count !== null && count > 0 && (
        <p className={`mt-1 text-[11px] ${th.textMuted}`}>
          {count} {count === 1 ? 'thing' : 'things'} changed since your last review.
        </p>
      )}

      <a
        href={deepLink}
        className={`mt-3 inline-flex items-center text-[11px] font-semibold text-[var(--accent)] hover:underline`}
      >
        Open in Briefing &rarr;
      </a>
    </section>
  );
}
