// components/mission-control/NewOpportunitiesSection.tsx
//
// MB-0002: narrative section 6, New Opportunities. Reuses the existing,
// tested BestOpportunitiesPanel (OE-0001) verbatim rather than duplicating
// its rendering logic -- composition over duplication. Carries the
// `id="best-opportunity"` anchor forward from TC-0001's CommandCenterNav
// ("Opportunity Review" link), which this sprint reuses unchanged.

import type { THEMES, Theme } from '@/lib/theme';
import type { OpportunityRecommendation } from '@/lib/opportunity-engine';
import { BestOpportunitiesPanel } from '@/components/opportunity-engine/BestOpportunitiesPanel';

export interface NewOpportunitiesSectionProps {
  items: OpportunityRecommendation[];
  generatedAt: string;
  th: (typeof THEMES)[Theme];
}

export function NewOpportunitiesSection({ items, generatedAt, th }: NewOpportunitiesSectionProps) {
  return (
    <section id="best-opportunity" aria-label="New Opportunities" className="mb-6">
      <h2 className={`mb-2 text-[12px] font-bold uppercase tracking-widest ${th.text}`}>New Opportunities</h2>
      <BestOpportunitiesPanel recommendations={items} generatedAt={generatedAt} th={th} />
    </section>
  );
}
