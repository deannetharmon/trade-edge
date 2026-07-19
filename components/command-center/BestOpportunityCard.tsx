// components/command-center/BestOpportunityCard.tsx
//
// TC-0001B: mounts the existing, tested BestOpportunitiesPanel (OE-0001)
// against a real (possibly empty) OpportunityRecommendation[] feed produced
// by lib/command-center/buildOpportunityRecommendations.ts's real
// adapter/ranker wiring. No mock data, no new fetch, no persistence, no
// cross-page state -- see that module's doc for the full rationale. Renders
// the panel's own empty state ("No ranked opportunity feed is available.")
// whenever no real feed exists, which is the honest state today.

import type { THEMES, Theme } from '@/lib/theme';
import type { CommandCenterOpportunityViewModel } from '@/lib/command-center';
import { BestOpportunitiesPanel } from '@/components/opportunity-engine/BestOpportunitiesPanel';

export interface BestOpportunityCardProps {
  opportunity: CommandCenterOpportunityViewModel;
  th: (typeof THEMES)[Theme];
}

export function BestOpportunityCard({ opportunity, th }: BestOpportunityCardProps) {
  return (
    <section className="mb-6" aria-label="Best Opportunity">
      <div className="mb-2 flex items-center justify-between">
        <h2 className={`text-[12px] font-bold uppercase tracking-widest ${th.text}`}>Best Opportunity</h2>
      </div>
      {opportunity.state === 'error' ? (
        <p className="text-[11px] text-red-400">{opportunity.message}</p>
      ) : (
        <BestOpportunitiesPanel
          recommendations={opportunity.recommendations}
          generatedAt={opportunity.generatedAt}
          th={th}
          blockerNotice={
            opportunity.state !== 'loaded'
              ? (opportunity.message ?? 'No ranked opportunity feed is available.')
              : undefined
          }
        />
      )}
    </section>
  );
}
