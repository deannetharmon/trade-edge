// features/portfolio/components/PositionRecommendationBadge.tsx
'use client';

import type { PortfolioRecommendation } from '../recommendations/recommendation-types';

const urgencyClass: Record<PortfolioRecommendation['urgency'], string> = {
  low: 'border-slate-500/60 bg-slate-500/10 text-slate-300',
  medium: 'border-amber-500/60 bg-amber-500/10 text-amber-300',
  high: 'border-orange-500/60 bg-orange-500/10 text-orange-300',
  critical: 'border-red-500/60 bg-red-500/10 text-red-300',
};

export function PositionRecommendationBadge({
  recommendation,
}: {
  recommendation: PortfolioRecommendation | null | undefined;
}) {
  if (!recommendation) return null;

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[9px] font-semibold tracking-wide ${urgencyClass[recommendation.urgency]}`}
      title={`${recommendation.primaryReason} Suggested action: ${recommendation.suggestedAction}`}
    >
      <span>{recommendation.label.toUpperCase()}</span>
      <span>{recommendation.urgency.toUpperCase()} URGENCY</span>
    </div>
  );
}
