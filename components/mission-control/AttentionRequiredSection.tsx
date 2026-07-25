// components/mission-control/AttentionRequiredSection.tsx
//
// MB-0002: narrative sections 3-5, folded into one -- Attention Required,
// Recommended Actions, and Supporting Evidence. Per MB-0001B's own design
// note (docs/design/MB-0001B-Review-Conductor-Foundation.md section 5),
// these are three narrative beats over one AttentionItem, not three separate
// lists: `headline` (what needs attention), `recommendedAction` (what to
// do), and `explanation` (why, and how confident). This component renders
// all three beats per item in one card so nothing is duplicated across
// sections -- exactly the presentation-layer decision that document
// deferred to this sprint.

import type { THEMES, Theme } from '@/lib/theme';
import type { AttentionItem } from '@/lib/morning-briefing';

export interface AttentionRequiredSectionProps {
  items: AttentionItem[];
  th: (typeof THEMES)[Theme];
}

function AttentionCard({ item, th }: { item: AttentionItem; th: (typeof THEMES)[Theme] }) {
  return (
    <li className={`rounded-lg border ${th.borderLight} p-3`}>
      <div className="flex items-start justify-between gap-3">
        <p className={`text-[12px] font-semibold ${th.text}`}>{item.headline}</p>
        {item.explanation && (
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${th.tag} ${th.textFaint}`}>
            {item.explanation.confidenceLabel}
          </span>
        )}
      </div>
      <p className={`mt-1 text-[11px] ${th.textMuted}`}>{item.recommendedAction}</p>
      {item.explanation && item.explanation.whyNow.length > 0 && (
        <p className={`mt-1 text-[10px] italic ${th.textFaint}`}>{item.explanation.whyNow[0]}</p>
      )}
    </li>
  );
}

export function AttentionRequiredSection({ items, th }: AttentionRequiredSectionProps) {
  return (
    <section aria-label="Attention Required" className={`mb-6 rounded-xl border ${th.border} ${th.card} p-4`}>
      <h2 className={`mb-3 text-[12px] font-bold uppercase tracking-widest ${th.text}`}>Attention Required</h2>

      {items.length === 0 ? (
        <p className={`text-[12px] ${th.textFaint}`}>Nothing needs your attention right now.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <AttentionCard key={item.id} item={item} th={th} />
          ))}
        </ul>
      )}
    </section>
  );
}
