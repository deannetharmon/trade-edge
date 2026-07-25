// components/mission-control/SummaryStrip.tsx
//
// MB-0002: the Mission Control "first viewport" -- per the CES, without
// scrolling the trader must understand Portfolio Health, the single
// highest-priority Lead Item, a Since-Last-Review summary, and an Attention
// summary. All four live here, in one calm, fixed strip at the top of the
// page. Everything below is progressive disclosure: the full detail behind
// each of these four lines.
//
// Every line is a direct read or simple template of an already-computed
// ReviewNarrative field -- health.status/score, leadItem, counts,
// complete.message. Nothing here computes, ranks, or infers a new fact.

import type { THEMES, Theme } from '@/lib/theme';
import type { PortfolioHealthStatus } from '@/lib/portfolioHealth';
import type { ReviewLeadItem, ReviewNarrative } from '@/lib/review-conductor';
import type { MissionControlSinceLastReviewSummary } from '@/lib/mission-control';

const HEALTH_STATUS_STYLE: Record<PortfolioHealthStatus, string> = {
  Healthy: 'text-emerald-400',
  'Needs Attention': 'text-amber-400',
  'Action Required': 'text-red-400',
};

function leadItemHeadline(leadItem: ReviewLeadItem | null): string {
  if (!leadItem) return 'Nothing needs your immediate attention.';
  if (leadItem.kind === 'COMMITMENT_CHANGE') {
    return leadItem.result.change?.whatChanged ?? `${leadItem.result.commitment.subject.label} needs a fresh look.`;
  }
  return leadItem.item.headline;
}

function attentionSummary(narrative: ReviewNarrative): string {
  if (narrative.complete.isComplete) return narrative.complete.message;
  const { attention } = narrative.counts;
  return `${attention} ${attention === 1 ? 'item needs' : 'items need'} your attention.`;
}

export interface SummaryStripProps {
  narrative: ReviewNarrative;
  // WA-0004 (CES section 7/10/11, corrective ruling): the same shared
  // summary buildMissionControlViewModel.ts builds for
  // SinceLastReviewSection -- this strip must never independently derive
  // "Nothing changed since your last review." from `narrative.counts.changes
  // === 0` alone, since that is structurally identical whether commitment
  // tracking never ran or ran and found nothing. Reusing the identical
  // pre-built summary guarantees this strip and the full section below can
  // never disagree.
  sinceLastReview: MissionControlSinceLastReviewSummary;
  th: (typeof THEMES)[Theme];
}

export function SummaryStrip({ narrative, sinceLastReview, th }: SummaryStripProps) {
  const health = narrative.portfolioStatus.review.currentState.health;

  return (
    <section
      aria-label="Review Summary"
      className={`mb-6 rounded-xl border ${th.border} ${th.card} p-5`}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className={`text-[11px] font-bold uppercase tracking-widest ${th.textFaint}`}>Am I okay?</p>
          <p className={`mt-1 text-lg font-bold ${HEALTH_STATUS_STYLE[health.status]}`}>
            {health.status} <span className={th.textFaint}>&middot; {health.score}</span>
          </p>
        </div>

        <div className="md:max-w-md md:text-right">
          <p className={`text-[11px] font-bold uppercase tracking-widest ${th.textFaint}`}>What deserves my attention?</p>
          <p className={`mt-1 text-sm font-semibold ${th.text}`}>{leadItemHeadline(narrative.leadItem)}</p>
        </div>
      </div>

      <div className={`mt-4 flex flex-col gap-1 border-t ${th.borderLight} pt-4 md:flex-row md:items-center md:justify-between md:gap-6`}>
        <p className={`text-[12px] ${th.textMuted}`}>{sinceLastReview.summary}</p>
        <p className={`text-[12px] ${th.textMuted}`}>{attentionSummary(narrative)}</p>
      </div>
    </section>
  );
}
