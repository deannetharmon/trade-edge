// components/command-center/CommandCenter.tsx
//
// TC-0001: the Trade Command Center's layout. Pure presentation over an
// already-built CommandCenterViewModel -- this component computes nothing.
// Desktop reading order matches docs/design/TC-0001-Trade-Command-Center.md
// section 6.1 exactly: header, Daily Briefing summary, Today's Priorities,
// Best Opportunity, Portfolio Health, Background Tasks.

import type { THEMES, Theme } from '@/lib/theme';
import type { CommandCenterViewModel } from '@/lib/command-center';
import { CommandCenterHeader } from './CommandCenterHeader';
import { CommandCenterNav } from './CommandCenterNav';
import { BriefingSummaryCard } from './BriefingSummaryCard';
import { PriorityListCard } from './PriorityListCard';
import { BestOpportunityCard } from './BestOpportunityCard';
import { PortfolioHealthCard } from './PortfolioHealthCard';
import { BackgroundTaskCard } from './BackgroundTaskCard';

export interface CommandCenterProps {
  viewModel: CommandCenterViewModel;
  th: (typeof THEMES)[Theme];
}

export function CommandCenter({ viewModel, th }: CommandCenterProps) {
  return (
    <main className={`mx-auto max-w-5xl px-4 py-6 ${th.bg}`}>
      <CommandCenterNav th={th} />
      <CommandCenterHeader header={viewModel.header} th={th} />
      <BriefingSummaryCard briefing={viewModel.briefing} th={th} />
      <PriorityListCard priorities={viewModel.priorities} th={th} />
      <div id="best-opportunity">
        <BestOpportunityCard opportunity={viewModel.bestOpportunity} th={th} />
      </div>
      <PortfolioHealthCard health={viewModel.health} th={th} />
      <BackgroundTaskCard backgroundTasks={viewModel.backgroundTasks} th={th} />
    </main>
  );
}
