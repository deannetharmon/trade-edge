// components/mission-control/AttentionRequiredSection.tsx
//
// WA-0003 (CES section 11, ruling 6): reduced from a full duplicate work
// queue to exactly four things -- lead open item headline, open-attention
// count, one-line compact summary, and one contextual deep link. The link
// always targets Today's Priorities via an absolute application path
// (`/portfolio?tab=todays-priorities&priority=<stableKey>`), never a
// query-only URL (this section renders on /dashboard) and never Positions
// or Decision History directly -- Mission Control's lead
// item, open count, and link target all derive from the same
// buildTodaysPrioritiesQueue()+partitionTodaysPrioritiesQueue() call Today's
// Priorities itself uses (lib/mission-control/buildMissionControlViewModel.ts),
// so they cannot drift apart. No Mark Complete/Reopen control, no full
// per-item card list -- that full experience lives only in Today's
// Priorities now.

import type { THEMES, Theme } from '@/lib/theme';
import type { MissionControlTodaysPrioritiesSummary } from '@/lib/mission-control';

export interface AttentionRequiredSectionProps {
  todaysPriorities: MissionControlTodaysPrioritiesSummary;
  th: (typeof THEMES)[Theme];
}

function leadItemHeadline(leadItem: MissionControlTodaysPrioritiesSummary['leadItem']): string {
  if (!leadItem) return 'Nothing needs your attention right now.';
  return leadItem.headline;
}

export function AttentionRequiredSection({ todaysPriorities, th }: AttentionRequiredSectionProps) {
  const { leadItem, openCount, deepLink } = todaysPriorities;

  return (
    <section aria-label="Attention Required" className={`mb-6 rounded-xl border ${th.border} ${th.card} p-4`}>
      <h2 className={`mb-3 text-[12px] font-bold uppercase tracking-widest ${th.text}`}>Attention Required</h2>

      <p className={`text-[12px] font-semibold ${th.text}`}>{leadItemHeadline(leadItem)}</p>

      {openCount > 0 && (
        <p className={`mt-1 text-[11px] ${th.textMuted}`}>
          {openCount} {openCount === 1 ? 'item needs' : 'items need'} your attention today.
        </p>
      )}

      {deepLink && (
        <a
          href={deepLink}
          className={`mt-3 inline-flex items-center text-[11px] font-semibold text-[var(--accent)] hover:underline`}
        >
          Open in Today's Priorities →
        </a>
      )}
    </section>
  );
}
