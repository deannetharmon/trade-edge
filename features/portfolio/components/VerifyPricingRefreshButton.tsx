'use client';

import { useRef, useState, type MouseEvent } from 'react';
import type { PortfolioRecommendation } from '../recommendations/recommendation-types';
import type { PortfolioRefreshResult } from '@/components/portfolio-data/PortfolioDataProvider';
import type { PortfolioObjective } from '@/lib/portfolio-intelligence';

interface RefreshActionProps {
  visible: boolean;
  positionKey: string;
  portfolioRefreshing: boolean;
  onRefresh: () => Promise<PortfolioRefreshResult>;
  onOutcome: (outcome: PricingRefreshOutcome | null) => void;
}

export interface PricingRefreshOutcome {
  tone: 'status' | 'error';
  message: string;
}

export function VerifyPricingRefreshButton({
  recommendation,
  positionKey,
  portfolioRefreshing,
  onRefresh,
  onOutcome,
}: {
  recommendation: PortfolioRecommendation | null | undefined;
  positionKey: string;
  portfolioRefreshing: boolean;
  onRefresh: () => Promise<PortfolioRefreshResult>;
  onOutcome: (outcome: PricingRefreshOutcome | null) => void;
}) {
  return (
    <RefreshQuotesAction
      visible={recommendation?.kind === 'verify-pricing'}
      positionKey={positionKey}
      portfolioRefreshing={portfolioRefreshing}
      onRefresh={onRefresh}
      onOutcome={onOutcome}
    />
  );
}

export function VerifyPricingObjectiveRefreshButton({
  objective,
  portfolioRefreshing,
  onRefresh,
  onOutcome,
}: {
  objective: PortfolioObjective;
  portfolioRefreshing: boolean;
  onRefresh: () => Promise<PortfolioRefreshResult>;
  onOutcome: (outcome: PricingRefreshOutcome | null) => void;
}) {
  return (
    <RefreshQuotesAction
      visible={objective.ruleId === 'OBJ-VERIFY-PRICING' && Boolean(objective.subject.id)}
      positionKey={objective.subject.id ?? ''}
      portfolioRefreshing={portfolioRefreshing}
      onRefresh={onRefresh}
      onOutcome={onOutcome}
    />
  );
}

function RefreshQuotesAction({ visible, positionKey, portfolioRefreshing, onRefresh, onOutcome }: RefreshActionProps) {
  const [requestedHere, setRequestedHere] = useState(false);
  const requestedRef = useRef(false);

  if (!visible) return null;

  const refreshOnce = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (requestedRef.current || portfolioRefreshing) return;
    requestedRef.current = true;
    setRequestedHere(true);
    onOutcome(null);
    try {
      const result = await onRefresh();
      if (result.status === 'error') {
        onOutcome({ tone: 'error', message: `Quote refresh failed; pricing remains unverified. ${result.message}` });
      } else if (result.status === 'superseded') {
        onOutcome({ tone: 'status', message: 'A newer portfolio refresh replaced this request.' });
      } else {
        const refreshedPosition = result.positions.find(position => position.key === positionKey);
        if (!refreshedPosition) {
          onOutcome({ tone: 'status', message: 'Quotes refreshed; this position is no longer open.' });
        } else if (
          refreshedPosition.pricingDecisionEvidence?.marketableDecisionEligible !== true
          || refreshedPosition.recommendation?.kind === 'verify-pricing'
        ) {
          onOutcome({ tone: 'status', message: 'Quotes refreshed; pricing is still unverified.' });
        } else {
          onOutcome({ tone: 'status', message: 'Pricing verified; recommendation updated.' });
        }
      }
    } finally {
      requestedRef.current = false;
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
    </span>
  );
}
