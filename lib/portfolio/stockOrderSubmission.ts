// lib/portfolio/stockOrderSubmission.ts
//
// STOCKS-ORDERS-0001 — THE single boundary every stock sell submission must
// pass through, in the same shape as closeOrderSubmission.ts's
// submitCloseOrderIfSafe (ES-0001 correction: the broker call must be written
// AS the callback passed here, so there is no statement-level path to a
// broker call that has not gone through the safety gate first). The gate is
// re-run here immediately before submit against a freshly-resolved capacity
// report -- never trusted from what the screen showed when the dialog opened.

import { resolveMaxSellableShares } from './stockOrderSafety';
import type { SellableSharesResult } from './stockOrderSafety';
import { buildStockSellOrder } from './stockOrderBuilder';
import type { BuildStockSellOrderInput, StockSellOrder } from './stockOrderBuilder';
import type { SnapshotCapacityReport } from '@/lib/portfolio-snapshot/capacity';

export type StockOrderGuardResult =
  | { allowed: false; reason: string; sellable: SellableSharesResult }
  | { allowed: true; order: StockSellOrder; sellable: SellableSharesResult };

/**
 * Re-resolves max sellable shares from a freshly-fetched capacity report and
 * checks the requested quantity against it, then builds the order body only
 * if that passes. `report` must be built from data fetched at (or just
 * before) submit time -- passing a stale report defeats the point of this gate.
 */
export function guardStockSellOrder(report: SnapshotCapacityReport, input: BuildStockSellOrderInput): StockOrderGuardResult {
  const sellable = resolveMaxSellableShares(report, input.symbol);
  if (input.quantity > sellable.maxSellableShares) {
    const reason = sellable.reason
      ?? `Only ${sellable.maxSellableShares} of ${sellable.sharesOwned} ${input.symbol} shares are available to sell; ${sellable.sharesCommitted} are committed to open or working covered calls.`;
    return { allowed: false, reason, sellable };
  }
  const built = buildStockSellOrder(input);
  if (!built.ok) return { allowed: false, reason: built.reason, sellable };
  return { allowed: true, order: built.order, sellable };
}

export type SubmitStockSellOrderResult<T> =
  | { submitted: true; result: T; sellable: SellableSharesResult }
  | { submitted: false; reason: string; sellable: SellableSharesResult };

/**
 * Write the actual ttPost/order-dry-run broker call INSIDE the
 * `submitToBroker` callback at the call site -- do not call
 * guardStockSellOrder separately and then make a broker call as a following
 * statement. That leaves the broker call reachable independent of the guard
 * passing, exactly the pattern ES-0001 corrected for option close orders.
 */
export async function submitStockSellOrderIfSafe<T>(
  report: SnapshotCapacityReport,
  input: BuildStockSellOrderInput,
  submitToBroker: (order: StockSellOrder) => Promise<T>,
): Promise<SubmitStockSellOrderResult<T>> {
  const guard = guardStockSellOrder(report, input);
  if (!guard.allowed) return { submitted: false, reason: guard.reason, sellable: guard.sellable };
  const result = await submitToBroker(guard.order);
  return { submitted: true, result, sellable: guard.sellable };
}
