// components/portfolio-data/PortfolioDataProvider.tsx
//
// TC-0001 corrective round: the shared client-side portfolio data provider
// the Product Owner directed as the corrective architecture (see
// docs/design/TC-0001-Trade-Command-Center.md's Corrective Round Addendum).
// Mounted once at the app-shell level (app/providers.tsx, alongside
// TaskProvider), this is now the ONE place `loadPositions()`/
// `loadAccountBalances()` (lib/portfolio-data/acquisition.ts -- relocated
// verbatim from app/portfolio/page.tsx, no logic changes) are invoked.
// app/portfolio/page.tsx and app/dashboard/page.tsx both consume this same
// context instead of each owning a private copy of the acquisition
// pipeline -- there is no second live TastyTrade acquisition path anywhere
// in the app.
//
// `refresh()` reproduces app/portfolio/page.tsx's original `fetchPositions`
// sequence exactly (same two setPositions calls, same fire-and-forget
// snapshot-history attachment), with the two snapshot-capture side effects
// (captureSnapshotsIfNeeded/captureLifecycleSnapshotsIfNeeded) now injected
// as optional callbacks rather than called inline -- those two functions
// were NOT part of the acquisition pipeline's dependency closure (verified:
// they are never called by loadPositions/attachSnapshotHistory/etc.) and
// remain exactly where they were, private to app/portfolio/page.tsx, which
// is the only caller that ever passes them. app/dashboard/page.tsx calls
// refresh() with no callbacks -- it does not duplicate snapshot-history
// bookkeeping, which remains app/portfolio/page.tsx's own responsibility.
//
// composition is computed here (not by each page separately) using the
// exact same buildDashboardComposition() contract and the exact same
// netEdge-evidence-attachment step app/portfolio/page.tsx's TC-0001A
// composition useMemo already used -- moved here verbatim, not
// re-implemented.

'use client';

import { createContext, useCallback, useContext, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { Position, PendingOrder } from '@/lib/portfolio-data/types';
import {
  loadPositions,
  loadAccountBalances,
  fetchSnapshotStore,
  attachSnapshotHistory,
  computeNetEdgeEvidence,
  scorePortfolioRemainingOpportunity,
} from '@/lib/portfolio-data/acquisition';
import type { PortfolioFinancialContext } from '@/lib/portfolio-intelligence';
import type { DecisionReviewStore } from '@/lib/decision-review';
import { buildDashboardComposition, type DashboardComposition } from '@/lib/portfolio-intelligence/dashboardComposition';

export interface RefreshPositionsCallbacks {
  // Called once, synchronously after the raw (pre-snapshot-history) load
  // completes -- matches captureSnapshotsIfNeeded's original call site
  // exactly (app/portfolio/page.tsx's own fetchPositions, before this move).
  onRawPositionsLoaded?: (positions: Position[]) => void;
  // Called once the snapshot-history attachment resolves -- matches
  // captureLifecycleSnapshotsIfNeeded's original call site exactly.
  onSnapshotHistoryAttached?: (positions: Position[]) => void;
}

export interface PortfolioDataContextValue {
  positions: Position[];
  pendingOrders: PendingOrder[];
  balances: PortfolioFinancialContext | null;
  decisionReviews: DecisionReviewStore;
  loading: boolean;
  error: string;
  lastRefresh: Date | null;
  composition: DashboardComposition;
  setPositions: Dispatch<SetStateAction<Position[]>>;
  setPendingOrders: Dispatch<SetStateAction<PendingOrder[]>>;
  setDecisionReviews: Dispatch<SetStateAction<DecisionReviewStore>>;
  setError: Dispatch<SetStateAction<string>>;
  refresh: (callbacks?: RefreshPositionsCallbacks) => Promise<void>;
  refreshBalances: () => Promise<void>;
  refreshDecisionReviews: () => Promise<void>;
}

const PortfolioDataContext = createContext<PortfolioDataContextValue | null>(null);

export function PortfolioDataProvider({ children }: { children: ReactNode }) {
  const [positions, setPositions] = useState<Position[]>([]);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [balances, setBalances] = useState<PortfolioFinancialContext | null>(null);
  const [decisionReviews, setDecisionReviews] = useState<DecisionReviewStore>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const refresh = useCallback(async (callbacks?: RefreshPositionsCallbacks) => {
    setLoading(true);
    setError('');
    try {
      const { positions: data, pendingOrders: pendingData } = await loadPositions();
      setPositions(data);
      setPendingOrders(pendingData);
      setLastRefresh(new Date());
      callbacks?.onRawPositionsLoaded?.(data);
      // Load snapshot history and attach it to positions (non-blocking; if it
      // fails the cards simply render without peak/trend context) -- same
      // fire-and-forget shape as the original fetchPositions.
      fetchSnapshotStore()
        .then(store => {
          setPositions(prev => {
            const updated = attachSnapshotHistory(prev, store);
            callbacks?.onSnapshotHistoryAttached?.(updated);
            return updated;
          });
        })
        .catch(e => console.error('Snapshot history fetch failed (non-blocking):', e));
    } catch (e: any) {
      if (e.message === 'Not authenticated' || e.message === 'Session expired') {
        window.location.href = '/login';
        return;
      }
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshBalances = useCallback(async () => {
    try {
      const b = await loadAccountBalances();
      setBalances(b);
    } catch (e) {
      console.error('Balance fetch failed (non-blocking):', e);
    }
  }, []);

  const refreshDecisionReviews = useCallback(async () => {
    try {
      const res = await fetch('/api/decision-reviews');
      if (!res.ok) throw new Error(`decision-reviews fetch ${res.status}`);
      const data = await res.json();
      setDecisionReviews(data?.reviews ?? {});
    } catch (e) {
      console.error('Decision review fetch failed (non-blocking):', e);
    }
  }, []);

  // TC-0001A composition step, moved here verbatim from
  // app/portfolio/page.tsx (see that file's history) -- netEdgeDeclinePct/
  // netEdgeNegative/remainingOpportunityPct are inputs to
  // buildDashboardComposition, not something it derives itself.
  const composition = useMemo(() => {
    const positionsWithEvidence = positions.map(p => {
      const { netEdgeDeclinePct, netEdgeNegative } = computeNetEdgeEvidence(p);
      const { remainingOpportunityPct } = scorePortfolioRemainingOpportunity(p);
      return { ...p, netEdgeDeclinePct, netEdgeNegative, remainingOpportunityPct };
    });
    return buildDashboardComposition({
      positions: positionsWithEvidence,
      pendingOrders,
      balances,
      decisionReviews,
    });
  }, [positions, pendingOrders, balances, decisionReviews]);

  const value: PortfolioDataContextValue = {
    positions,
    pendingOrders,
    balances,
    decisionReviews,
    loading,
    error,
    lastRefresh,
    composition,
    setPositions,
    setPendingOrders,
    setDecisionReviews,
    setError,
    refresh,
    refreshBalances,
    refreshDecisionReviews,
  };

  return <PortfolioDataContext.Provider value={value}>{children}</PortfolioDataContext.Provider>;
}

export function usePortfolioData(): PortfolioDataContextValue {
  const ctx = useContext(PortfolioDataContext);
  if (!ctx) {
    throw new Error('usePortfolioData must be used within a PortfolioDataProvider');
  }
  return ctx;
}
