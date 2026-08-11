'use client';

import { useState, type MouseEvent } from 'react';
import type { PortfolioRecommendation } from '../recommendations/recommendation-types';
import type { PortfolioRefreshResult } from '@/components/portfolio-data/PortfolioDataProvider';
import type { PortfolioObjective } from '@/lib/portfolio-intelligence';

interface RefreshActionProps {
  visible: boolean;
  positionKey: string;
  portfolioRefreshing: boolean;
  onRefresh: () => Promise<PortfolioRefreshResult>;
}

export function VerifyPricingRefreshButton({
  recommendation,
  positionKey,
  portfolioRefreshing,
  onRefresh,
}: {
  recommendation: PortfolioRecommendation | null | undefined;
  positionKey: string;
  portfolioRefreshing: boolean;
  onRefresh: () => Promise<PortfolioRefreshResult>;
}) {
  return (
    <RefreshQuotesAction
      visible={recommendation?.kind === 'verify-pricing'}
      positionKey={positionKey}
      portfolioRefreshing={portfolioRefreshing}
      onRefresh={onRefresh}
    />
  );
}

export function VerifyPricingObjectiveRefreshButton({
  objective,
  portfolioRefreshing,
  onRefresh,
}: {
  objective: PortfolioObjective;
  portfolioRefreshing: boolean;
  onRefresh: () => Promise<PortfolioRefreshResult>;
}) {
  return (
    <RefreshQuotesAction
      visible={objective.ruleId === 'OBJ-VERIFY-PRICING' && Boolean(objective.subject.id)}
      positionKey={objective.subject.id ?? ''}
      portfolioRefreshing={portfolioRefreshing}
      onRefresh={onRefresh}
    />
  );
}

function RefreshQuotesAction({ visible, positionKey, portfolioRefreshing, onRefresh }: RefreshActionProps) {
  const [requestedHere, setRequestedHere] = useState(false);
  const [outcome, setOutcome] = useState<{ tone: 'status' | 'error'; message: string } | null>(null);

  if (!visible) return null;

  const refreshOnce = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (portfolioRefreshing) return;
    setRequestedHere(true);
    setOutcome(null);
    try {
      const result = await onRefresh();
      if (result.status === 'error') {
        setOutcome({ tone: 'error', message: `Quote refresh failed; pricing remains unverified. ${result.message}` });
      } else if (result.status === 'superseded') {
        setOutcome({ tone: 'status', message: 'A newer portfolio refresh replaced this request.' });
      } else {
        const refreshedPosition = result.positions.find(position => position.key === positionKey);
        if (!refreshedPosition) {
          setOutcome({ tone: 'status', message: 'Quotes refreshed; this position is no longer open.' });
        } else if (refreshedPosition.recommendation?.kind === 'verify-pricing') {
          setOutcome({ tone: 'status', message: 'Quotes refreshed; pricing is still unverified.' });
        } else {
          setOutcome({ tone: 'status', message: 'Pricing verified; recommendation updated.' });
        }
      }
    } finally {
      setRequestedHere(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={refreshOnce}
        disabled={portfolioRefreshing}
        aria-busy={requestedHere && portfolioRefreshing}
        className="text-[9px] px-2.5 py-1 border rounded font-bold whitespace-nowrap transition-colors border-amber-500 text-amber-300 hover:bg-amber-500/10 disabled:cursor-wait disabled:opacity-60"
        title="Fetch current broker leg quotes once and reevaluate this position"
      >
        {requestedHere && portfolioRefreshing ? 'REFRESHING QUOTES...' : '↻ REFRESH QUOTES'}
      </button>
      {outcome && (
        <span
          role={outcome.tone === 'error' ? 'alert' : 'status'}
          className={`max-w-72 text-[9px] ${outcome.tone === 'error' ? 'text-red-400' : 'text-amber-300'}`}
        >
          {outcome.message}
        </span>
      )}
    </span>
  );
}
