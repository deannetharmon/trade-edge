'use client';

import { useState, type MouseEvent } from 'react';
import type { PortfolioRecommendation } from '../recommendations/recommendation-types';

export function VerifyPricingRefreshButton({
  recommendation,
  onRefresh,
}: {
  recommendation: PortfolioRecommendation | null | undefined;
  onRefresh: () => Promise<void>;
}) {
  const [refreshing, setRefreshing] = useState(false);

  if (recommendation?.kind !== 'verify-pricing') return null;

  const refreshOnce = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <button
      type="button"
      onClick={refreshOnce}
      disabled={refreshing}
      aria-busy={refreshing}
      className="text-[9px] px-2.5 py-1 border rounded font-bold whitespace-nowrap transition-colors border-amber-500 text-amber-300 hover:bg-amber-500/10 disabled:cursor-wait disabled:opacity-60"
      title="Fetch current broker quotes once and reevaluate this position"
    >
      {refreshing ? 'REFRESHING QUOTES...' : '↻ REFRESH QUOTES'}
    </button>
  );
}
