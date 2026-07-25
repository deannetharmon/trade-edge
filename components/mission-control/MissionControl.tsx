// components/mission-control/MissionControl.tsx
//
// MB-0002: Mission Control -- the approved Concept B Review experience,
// replacing TC-0001's CommandCenter as /dashboard's layout. Pure
// presentation over an already-built MissionControlViewModel; this
// component computes nothing and reuses lib/review-conductor's
// ReviewNarrative exactly as produced (Quinn's MB-0002 acceptance
// criteria).
//
// Narrative order (do not rearrange, per the CES): Portfolio Status, Since
// Your Last Review, Attention Required (folding in Recommended Actions and
// Supporting Evidence, per MB-0001B's own design note), New Opportunities,
// Review Complete. DOM order matches this exactly on every breakpoint --
// there is no CSS `order` trick and no separate mobile/desktop component
// tree, so keyboard and screen-reader order can never diverge from visual
// order. See docs/design/MB-0002-Mission-Control-Implementation.md section
// 3 for the rationale (a deliberate, disclosed simplification from Phase
// 1's two-column sketch, chosen specifically to make "narrative order
// remains intact across all layouts" true by construction rather than by
// careful CSS).
//
// SummaryStrip sits above all seven sections as the "first viewport" --
// per the CES, a compact preview of Portfolio Health, the Lead Item, Since
// Last Review, and Attention Summary, so all three mission questions are
// answerable without scrolling. Everything below is the full narrative,
// revealed by scrolling ("progressive disclosure").

import { CommandCenterNav } from '@/components/command-center/CommandCenterNav';
import type { THEMES, Theme } from '@/lib/theme';
import type { MissionControlViewModel } from '@/lib/mission-control';
import { SummaryStrip } from './SummaryStrip';
import { PortfolioStatusSection } from './PortfolioStatusSection';
import { SinceLastReviewSection } from './SinceLastReviewSection';
import { AttentionRequiredSection } from './AttentionRequiredSection';
import { NewOpportunitiesSection } from './NewOpportunitiesSection';
import { ReviewCompleteBand } from './ReviewCompleteBand';

export interface MissionControlProps {
  viewModel: MissionControlViewModel;
  th: (typeof THEMES)[Theme];
}

export function MissionControl({ viewModel, th }: MissionControlProps) {
  const { state, message, narrative, todaysPriorities } = viewModel;

  return (
    <main className={`mx-auto max-w-3xl px-4 py-6 ${th.bg}`}>
      <CommandCenterNav th={th} />

      {state === 'loading' && (
        <div role="status" aria-live="polite" className={`rounded-xl border ${th.border} ${th.card} p-6 text-center`}>
          <p className={`text-[12px] ${th.textFaint}`}>Preparing your Review&hellip;</p>
        </div>
      )}

      {state === 'error' && (
        <div role="alert" className={`rounded-xl border border-red-800 bg-red-500/5 p-6 text-center`}>
          <p className="text-[12px] text-red-400">{message}</p>
        </div>
      )}

      {state === 'unavailable' && (
        <div className={`rounded-xl border ${th.border} ${th.card} p-6 text-center`}>
          <p className={`text-[12px] ${th.textFaint}`}>{message}</p>
        </div>
      )}

      {state === 'loaded' && narrative && (
        <>
          <SummaryStrip narrative={narrative} th={th} />
          <PortfolioStatusSection review={narrative.portfolioStatus.review} th={th} />
          <SinceLastReviewSection changes={narrative.sinceLastReview.changes} th={th} />
          <AttentionRequiredSection todaysPriorities={todaysPriorities} th={th} />
          <NewOpportunitiesSection items={narrative.newOpportunities.items} generatedAt={narrative.generatedAt} th={th} />
          <ReviewCompleteBand narrative={narrative} th={th} />
        </>
      )}
    </main>
  );
}
