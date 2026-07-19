// lib/portfolio-mode/liveAdapter.ts
//
// PT-0002A: the LIVE adapter required by the design doc's architecture
// diagram. This is a thin wrapper -- it calls the existing, canonical
// `usePortfolioData()` (components/portfolio-data/PortfolioDataProvider.tsx,
// the TC-0001 corrective-round shared provider) and reshapes its result into
// the PortfolioModeAdapterState<T> envelope (lib/portfolio-mode/contract.ts).
// It introduces NO new acquisition logic, NO new state, and NO second call
// site for loadPositions()/loadAccountBalances() -- there remains exactly
// one runtime call site for each, inside PortfolioDataProvider itself, per
// TC-0001's "one canonical composition pipeline" guarantee. This file is not
// wired into any existing screen in PT-0002A (see the Implementation
// Report's Known Limitations) -- it exists as tested, ready-to-consume
// infrastructure for PT-0002B.

'use client';

import { useCallback, useMemo } from 'react';
import { usePortfolioData } from '@/components/portfolio-data/PortfolioDataProvider';
import type { Position, PendingOrder } from '@/lib/portfolio-data/types';
import type { PortfolioFinancialContext } from '@/lib/portfolio-intelligence';
import type { DashboardComposition } from '@/lib/portfolio-intelligence/dashboardComposition';
import type { PortfolioModeAdapterState } from './contract';

export interface LivePortfolioModeData {
  positions: Position[];
  pendingOrders: PendingOrder[];
  balances: PortfolioFinancialContext | null;
  composition: DashboardComposition;
}

/**
 * Must be called from within a PortfolioDataProvider (mounted once at
 * app/providers.tsx's shell root, same as app/portfolio/page.tsx and
 * app/dashboard/page.tsx already require) -- usePortfolioData() itself
 * throws if that precondition isn't met, so this adapter inherits that
 * enforcement rather than re-implementing it.
 */
export function useLivePortfolioModeAdapter(): PortfolioModeAdapterState<LivePortfolioModeData> {
  const { positions, pendingOrders, balances, composition, loading, error, lastRefresh, refresh } = usePortfolioData();

  const data = useMemo<LivePortfolioModeData>(
    () => ({ positions, pendingOrders, balances, composition }),
    [positions, pendingOrders, balances, composition],
  );

  const refreshAdapter = useCallback(async () => {
    await refresh();
  }, [refresh]);

  return {
    mode: 'LIVE',
    status: loading ? 'loading' : error ? 'error' : 'ready',
    error: error || null,
    lastRefreshedAt: lastRefresh ? lastRefresh.toISOString() : null,
    data,
    refresh: refreshAdapter,
  };
}
