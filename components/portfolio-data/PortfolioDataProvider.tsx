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
// PI-0014C strengthens `refresh()` into a latest-request-wins, typed
// completion contract. Broker positions are not published until snapshot
// history has been attached and canonical health/recommendation/objective
// fields have been recomputed. The two snapshot-capture side effects
// (captureSnapshotsIfNeeded/captureLifecycleSnapshotsIfNeeded) remain injected
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

import { createContext, useCallback, useContext, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { Position, PendingOrder, PositionSnapshot } from '@/lib/portfolio-data/types';
import type { PortfolioSnapshot, SnapshotDataQuality } from '@/lib/portfolio-snapshot/types';
import { acquirePortfolioSnapshot, LCC_0001A_SNAPSHOT_ENABLED } from '@/lib/portfolio-snapshot/acquire';
import { ACCOUNT_UNRESOLVED_REASON, POSITIONS_UNAVAILABLE_REASON } from '@/lib/portfolio-snapshot/dataQuality';
import {
  loadPositions,
  loadAccountBalances,
  fetchSnapshotStore,
  attachSnapshotHistory,
  computeNetEdgeEvidence,
  scorePortfolioRemainingOpportunity,
} from '@/lib/portfolio-data/acquisition';
import { fetchTrendStore } from '@/lib/portfolio/trendFetch';
import type { PortfolioFinancialContext } from '@/lib/portfolio-intelligence';
import type { DecisionReviewStore } from '@/lib/decision-review';
import { buildDashboardComposition, type DashboardComposition } from '@/lib/portfolio-intelligence/dashboardComposition';

export interface RefreshPositionsCallbacks {
  // Called with the raw broker positions only after this request has survived
  // both latest-generation checks and canonical recomputation. This prevents
  // a superseded request from writing stale snapshot side effects. The
  // current capture intentionally becomes context for the next refresh; the
  // current refresh evaluates against previously persisted history.
  onRawPositionsLoaded?: (positions: Position[]) => void;
  // Called once the snapshot-history attachment resolves -- matches
  // captureLifecycleSnapshotsIfNeeded's original call site exactly.
  onSnapshotHistoryAttached?: (positions: Position[]) => void;
}

export type PortfolioRefreshResult =
  | { status: 'success'; positions: Position[] }
  | { status: 'error'; message: string }
  | { status: 'superseded' };

export interface PortfolioDataContextValue {
  positions: Position[];
  pendingOrders: PendingOrder[];
  balances: PortfolioFinancialContext | null;
  decisionReviews: DecisionReviewStore;
  loading: boolean;
  error: string;
  lastRefresh: Date | null;
  composition: DashboardComposition;
  // LCC-0001A PR 2 — additive fields, per docs/design/LCC-0001A-technical-spec.md §10.3. Null
  // when the LCC_0001A_SNAPSHOT_ENABLED flag is off (default) or before the first snapshot
  // acquisition completes. No existing field's shape or timing contract changes.
  snapshot: PortfolioSnapshot | null;
  snapshotDataQuality: SnapshotDataQuality;
  setPositions: Dispatch<SetStateAction<Position[]>>;
  setPendingOrders: Dispatch<SetStateAction<PendingOrder[]>>;
  setDecisionReviews: Dispatch<SetStateAction<DecisionReviewStore>>;
  setError: Dispatch<SetStateAction<string>>;
  refresh: (callbacks?: RefreshPositionsCallbacks) => Promise<PortfolioRefreshResult>;
  refreshBalances: () => Promise<void>;
  refreshDecisionReviews: () => Promise<void>;
}

const PortfolioDataContext = createContext<PortfolioDataContextValue | null>(null);

export function PortfolioDataProvider({ children }: { children: ReactNode }) {
  const [positions, setPositionsState] = useState<Position[]>([]);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [balances, setBalances] = useState<PortfolioFinancialContext | null>(null);
  const [decisionReviews, setDecisionReviews] = useState<DecisionReviewStore>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  // LCC-0001A PR 2 — additive state. snapshotDataQuality defaults to 'unavailable' before any
  // acquisition has run (or when the flag is off), never a fabricated 'ok'.
  const [snapshot, setSnapshot] = useState<PortfolioSnapshot | null>(null);
  const [snapshotDataQuality, setSnapshotDataQuality] = useState<SnapshotDataQuality>({
    status: 'unavailable',
    staleQuotes: false,
    warnings: [],
  });
  // Monotonic request identity makes every portfolio refresh latest-wins.
  // A slower, older broker response can never overwrite newer quote evidence,
  // and only the current request is allowed to clear the shared loading state.
  const refreshGenerationRef = useRef(0);
  const positionsRef = useRef<Position[]>([]);
  const setPositions = useCallback<Dispatch<SetStateAction<Position[]>>>((nextValue) => {
    setPositionsState(previous => {
      const next = typeof nextValue === 'function'
        ? (nextValue as (previous: Position[]) => Position[])(previous)
        : nextValue;
      positionsRef.current = next;
      return next;
    });
  }, []);

  const refresh = useCallback(async (callbacks?: RefreshPositionsCallbacks): Promise<PortfolioRefreshResult> => {
    const generation = ++refreshGenerationRef.current;
    setLoading(true);
    setError('');
    try {
      // With LCC-0001A enabled, the existing option view and the new snapshot
      // are derived from one broker source. The legacy path is unchanged while
      // the flag remains off.
      const snapshotAcquisition = LCC_0001A_SNAPSHOT_ENABLED
        ? await acquirePortfolioSnapshot()
        : null;
      const acquisitionReason = snapshotAcquisition?.snapshot.dataQuality.unavailableReason;
      if (snapshotAcquisition &&
          (acquisitionReason === ACCOUNT_UNRESOLVED_REASON || acquisitionReason === POSITIONS_UNAVAILABLE_REASON)) {
        if (generation !== refreshGenerationRef.current) return { status: 'superseded' };
        const unavailableQuality = snapshotAcquisition.snapshot.dataQuality;
        setSnapshotDataQuality(unavailableQuality);
        setSnapshot(previous => previous
          ? { ...previous, dataQuality: unavailableQuality, freshness: 'last-known', lastSuccessfulAsOf: previous.lastSuccessfulAsOf ?? previous.asOf }
          : snapshotAcquisition.snapshot);
        throw new Error(acquisitionReason);
      }
      const { positions: data, pendingOrders: pendingData } = snapshotAcquisition
        ? {
            positions: snapshotAcquisition.snapshot.options,
            pendingOrders: snapshotAcquisition.pendingOrders,
          }
        : await loadPositions();
      if (generation !== refreshGenerationRef.current) return { status: 'superseded' };

      // A refresh is not complete until canonical health, pricing evidence,
      // recommendation, and objective fields have been rebuilt. Snapshot
      // history is contextual; if that endpoint fails, recompute from the
      // fresh broker positions with an empty store rather than publishing raw
      // positions or pretending recommendation reevaluation completed.
      //
      // PI-0006B-FOLLOWUP: trend store fetched in parallel, same
      // non-blocking resilience as snapshot history -- a failed/partial
      // trend fetch degrades individual positions to 'unknown' technical
      // alignment (via technicalAlignmentForStrategy's own fallback), it
      // never blocks or fails the refresh. Deduped by unique symbol across
      // the whole freshly-loaded position set, not fetched per-position.
      const [snapshotStore, trendStore] = await Promise.all([
        fetchSnapshotStore().catch((snapshotError) => {
          console.error('Snapshot history fetch failed; recomputing from fresh broker positions:', snapshotError);
          return {} as Record<string, PositionSnapshot[]>;
        }),
        fetchTrendStore(data.map(p => p.symbol)).catch((trendError) => {
          console.error('Trend store fetch failed; recomputing with unknown technical alignment:', trendError);
          return {};
        }),
      ]);
      const trendDirectionBySymbol = Object.fromEntries(
        Object.entries(trendStore).map(([symbol, classification]) => [symbol, classification.trend])
      );
      // Canonical recomputation owns the in-session Verify Pricing transition.
      // The provider supplies prior provenance but never authors or overwrites
      // recommendation policy after evaluation.
      const updated = attachSnapshotHistory(data, snapshotStore, positionsRef.current, trendDirectionBySymbol);
      if (generation !== refreshGenerationRef.current) return { status: 'superseded' };

      if (snapshotAcquisition) {
        // Publish the canonically recomputed Position[] on the snapshot too,
        // so context.positions and snapshot.options cannot drift after the
        // existing history/health enrichment step.
        const nextSnapshot = { ...snapshotAcquisition.snapshot, options: updated };
        setSnapshot(nextSnapshot);
        setSnapshotDataQuality(nextSnapshot.dataQuality);
      }

      callbacks?.onRawPositionsLoaded?.(data);
      setPositions(updated);
      setPendingOrders(pendingData);
      setLastRefresh(new Date());
      callbacks?.onSnapshotHistoryAttached?.(updated);
      return { status: 'success', positions: updated };
    } catch (e: unknown) {
      if (generation !== refreshGenerationRef.current) return { status: 'superseded' };
      const message = e instanceof Error ? e.message : String(e ?? 'Portfolio refresh failed');
      if (message === 'Not authenticated' || message === 'Session expired') {
        window.location.href = '/login';
        return { status: 'error', message };
      }
      setError(message);
      return { status: 'error', message };
    } finally {
      if (generation === refreshGenerationRef.current) setLoading(false);
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
    snapshot,
    snapshotDataQuality,
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
  const ctx = useOptionalPortfolioData();
  if (!ctx) {
    throw new Error('usePortfolioData must be used within a PortfolioDataProvider');
  }
  return ctx;
}

/** Optional consumer seam for route-level enhancements that must remain
 * renderable in isolated tools/tests where the app-shell provider is absent. */
export function useOptionalPortfolioData(): PortfolioDataContextValue | null {
  return useContext(PortfolioDataContext);
}
