// features/screener/components/TopOpportunityFrame.tsx
'use client';

// SCAN-TOP-0002 (Dean, 2026-11-02): one standard for "Best opportunity" on every strategy. A gold tab sits ON the
// card's top border, with a gold outline, so it takes no space in the card's row and no column moves. Earned top picks
// only (rank != null); every card with advisor reasoning also gets the collapsed "Why this ranks here" panel.

import type { ReactNode } from 'react';
import type { BestOpportunityRow } from '@/features/screener/lib/bestOpportunityRows';
import { WhyRanksHerePanel } from './WhyRanksHerePanel';

export interface TopOpportunityFrameProps {
  /** 1-based position among the earned top picks; null/undefined = not a top pick (no tab, no outline). */
  rank?: number | null;
  /** Advisor reasoning for this card; null/undefined = no panel. */
  row?: BestOpportunityRow | null;
  borderClassName?: string;
  textFaintClassName?: string;
  textMutedClassName?: string;
  children: ReactNode;
}

export function TopOpportunityFrame({ rank, row, borderClassName, textFaintClassName, textMutedClassName, children }: TopOpportunityFrameProps) {
  const top = rank != null;
  return (
    <div className={top ? 'relative mt-3 rounded-lg ring-1 ring-amber-400/70' : undefined} data-testid={top ? 'top-opportunity-frame' : undefined}>
      {top && (
        <span
          data-testid="top-opportunity-marker"
          className="absolute -top-2.5 left-4 z-10 rounded bg-amber-400 px-2.5 py-px text-[11px] font-bold tracking-wide text-slate-900"
        >
          ★ BEST OPPORTUNITY #{rank}
        </span>
      )}
      {children}
      {row && (
        <WhyRanksHerePanel row={row} borderClassName={borderClassName} textFaintClassName={textFaintClassName} textMutedClassName={textMutedClassName} />
      )}
    </div>
  );
}
