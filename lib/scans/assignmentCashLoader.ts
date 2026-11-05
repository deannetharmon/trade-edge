// lib/scans/assignmentCashLoader.ts

// ASSIGN-CASH-0001 -- fetches the three inputs the assignment-cash check needs (cash-balance, open positions, working
// orders) in one pass. Any source that fails to load comes back null, which the pure module treats as cannot_verify.
// Never substitutes an empty list for a failed load: an empty list would read as "no obligation".

import { acquirePortfolioBrokerSource, loadPositions } from '@/lib/portfolio-data/acquisition';
import { buildPortfolioFinancialContext } from '@/lib/portfolio-intelligence/adapters/balancesNormalization';
import { ttFetch } from '@/lib/tastytrade/client';
import type { PendingOrder, Position } from '@/lib/portfolio-data/types';

export interface AssignmentCashSnapshot {
  cashBalance: number | null;
  positions: Position[] | null;
  pendingOrders: PendingOrder[] | null;
}

export async function loadAssignmentCashSnapshot(): Promise<AssignmentCashSnapshot> {
  const empty: AssignmentCashSnapshot = { cashBalance: null, positions: null, pendingOrders: null };
  try {
    const source = await acquirePortfolioBrokerSource();

    const [balances, loaded] = await Promise.allSettled([
      ttFetch(`/accounts/${source.accountNumber}/balances`, source.token),
      loadPositions(source),
    ]);

    const cashBalance = balances.status === 'fulfilled'
      ? buildPortfolioFinancialContext(balances.value?.data ?? {}).cashBalance ?? null
      : null;

    if (loaded.status !== 'fulfilled') return { ...empty, cashBalance };

    // Working orders come from /orders/live and /complex-orders. If either source failed to load, the list may be
    // incomplete, so it is reported as unavailable instead of being trusted.
    const ordersComplete = source.rawLiveOrders != null && source.rawComplexOrders != null;

    return {
      cashBalance,
      positions: loaded.value.positions,
      pendingOrders: ordersComplete ? loaded.value.pendingOrders : null,
    };
  } catch {
    return empty;
  }
}
