// components/command-center/BriefingSummaryCard.tsx
//
// TC-0001: concise Daily Briefing executive-summary card, reusing the
// existing deterministic Daily Briefing capability's own output verbatim --
// no rule logic reproduced here.

import type { THEMES, Theme } from '@/lib/theme';
import type { CommandCenterBriefingViewModel } from '@/lib/command-center';

export interface BriefingSummaryCardProps {
  briefing: CommandCenterBriefingViewModel;
  th: (typeof THEMES)[Theme];
}

export function BriefingSummaryCard({ briefing, th }: BriefingSummaryCardProps) {
  return (
    <section className={`mb-6 rounded-xl border ${th.border} ${th.card} p-4`} aria-label="Daily Briefing Summary">
      <h2 className={`mb-2 text-[12px] font-bold uppercase tracking-widest ${th.text}`}>Today&rsquo;s Briefing</h2>
      {briefing.state === 'loaded' && briefing.executiveSummary ? (
        <p className={`text-[13px] leading-relaxed ${th.textMuted}`}>{briefing.executiveSummary}</p>
      ) : (
        <p className={`text-[11px] ${briefing.state === 'error' ? 'text-red-400' : th.textFaint}`}>
          {briefing.message ?? 'Daily Briefing is unavailable.'}
        </p>
      )}
    </section>
  );
}
