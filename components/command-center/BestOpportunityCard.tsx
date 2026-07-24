// components/command-center/BestOpportunityCard.tsx
//
// TC-0001B: mounts the existing, tested BestOpportunitiesPanel (OE-0001)
// against a real (possibly empty) OpportunityRecommendation[] feed produced
// by lib/command-center/buildOpportunityRecommendations.ts's real
// adapter/ranker wiring. This component itself has no idea where the
// underlying DecisionAnalysis[] came from -- as of CES-0001 (OE-0002B), its
// caller (app/dashboard/page.tsx) sources that from
// lib/recommendations/RecommendationService, the canonical acquisition
// boundary. Renders the panel's own empty state ("No ranked opportunity
// feed is available.") whenever nothing has been published yet, which is
// an honest state, never a fabricated one.

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
