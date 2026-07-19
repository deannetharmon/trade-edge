// components/command-center/PriorityListCard.tsx
//
// TC-0001: Today's Priorities card -- reuses the exact same
// <PriorityRankedList> Portfolio Review, Mission Control, and the Daily
// Briefing card already render, fed the canonical, already-scored/ordered
// PrioritizedObjective[]. This component does not sort, filter, or rescore.

import Link from 'next/link';
import type { THEMES, Theme } from '@/lib/theme';
import type { CommandCenterPrioritiesViewModel } from '@/lib/command-center';
import { PriorityRankedList } from '@/features/portfolio/dashboard/TodaysPrioritiesDashboard';

export interface PriorityListCardProps {
  priorities: CommandCenterPrioritiesViewModel;
  th: (typeof THEMES)[Theme];
}

export function PriorityListCard({ priorities, th }: PriorityListCardProps) {
  return (
    <section className={`mb-6 rounded-xl border ${th.border} ${th.card} p-4`} aria-label="Today's Priorities">
      <div className="mb-2 flex items-center justify-between">
        <h2 className={`text-[12px] font-bold uppercase tracking-widest ${th.text}`}>Today&rsquo;s Priorities</h2>
        <Link href="/portfolio" className={`text-[11px] font-semibold underline ${th.textFaint}`}>
          View in Portfolio
        </Link>
      </div>
      {priorities.state === 'loaded' && priorities.items.length > 0 ? (
        <PriorityRankedList items={priorities.items} th={th} />
      ) : (
        <p className={`text-[11px] ${priorities.state === 'error' ? 'text-red-400' : th.textFaint}`}>
          {priorities.message ?? 'No portfolio actions currently require attention.'}
        </p>
      )}
    </section>
  );
}
