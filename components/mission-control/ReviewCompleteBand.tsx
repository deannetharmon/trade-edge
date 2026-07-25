// components/mission-control/ReviewCompleteBand.tsx
//
// MB-0002: narrative section 7, Review Complete -- deliberately NOT styled
// like the bordered `${th.card}` sections above it. Per the CES this is
// "permanent Review chrome," not another card, widget, or footer: it uses a
// full-width, unbordered band with its own centered treatment so it reads as
// the deliberate end of the Review, not one more item in a list.
//
// When the Review is complete, this renders ReviewNarrative.complete.message
// verbatim (the exact string lib/review-conductor already produced for this
// state). When it is not complete, this does not fabricate a new sentence --
// it states the already-known counts back to the trader (how many items
// above still need attention) so arriving here always means "you've reached
// the end and seen everything," never a dead end with nothing to say.

import type { THEMES, Theme } from '@/lib/theme';
import type { ReviewNarrative } from '@/lib/review-conductor';

export interface ReviewCompleteBandProps {
  narrative: ReviewNarrative;
  th: (typeof THEMES)[Theme];
}

export function ReviewCompleteBand({ narrative, th }: ReviewCompleteBandProps) {
  const { complete, counts } = narrative;
  const outstanding = counts.changes + counts.attention;

  return (
    <section aria-label="Review Complete" className={`mt-4 border-t ${th.borderLight} py-8 text-center`}>
      <div className="mx-auto max-w-md">
        <p className={`text-2xl ${complete.isComplete ? 'text-emerald-400' : th.textFaint}`} aria-hidden="true">
          {complete.isComplete ? '✓' : '—'}
        </p>
        <p className={`mt-2 text-sm font-semibold ${th.text}`}>
          {complete.isComplete
            ? complete.message
            : `You've reached the end of this Review. ${outstanding} ${outstanding === 1 ? 'item' : 'items'} above still ${outstanding === 1 ? 'needs' : 'need'} your attention.`}
        </p>
        <p className={`mt-1 text-[10px] ${th.textFaint}`}>Nothing was skipped.</p>
      </div>
    </section>
  );
}
