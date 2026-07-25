// components/mission-control/SinceLastReviewSection.tsx
//
// MB-0002: narrative section 2, Since Your Last Review. Pure presentation
// over RevalidationResult[] (already filtered to changed:true by
// lib/review-conductor) -- renders each commitment change's what/why/why-now
// verbatim. An empty list is an honest, common state, not a missing-data
// problem, and is stated explicitly rather than left blank (see
// docs/design/MB-0002-Review-Concepts.md's "never make the trader hunt for
// reassurance").

import type { THEMES, Theme } from '@/lib/theme';
import type { RevalidationResult } from '@/lib/revalidation';

export interface SinceLastReviewSectionProps {
  changes: RevalidationResult[];
  th: (typeof THEMES)[Theme];
}

export function SinceLastReviewSection({ changes, th }: SinceLastReviewSectionProps) {
  return (
    <section aria-label="Since Your Last Review" className={`mb-6 rounded-xl border ${th.border} ${th.card} p-4`}>
      <h2 className={`mb-3 text-[12px] font-bold uppercase tracking-widest ${th.text}`}>Since Your Last Review</h2>

      {changes.length === 0 ? (
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
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
