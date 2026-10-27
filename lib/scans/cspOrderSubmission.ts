// lib/scans/cspOrderSubmission.ts
//
// CSP-ORDERS-0001 -- the submit-time collateral re-check, same pattern as
// lib/portfolio/stockOrderSubmission.ts's submitStockSellOrderIfSafe (ES-0001
// correction): the broker call must be written AS the callback passed here,
// so there is no statement-level path to a broker call that has not gone
// through this gate first. Re-resolves capital from a freshly-fetched
// CspCapitalContext immediately before submit -- never trusted from what the
// screen showed when the trade modal opened.

import { computeCspMaxLoss } from './cspOrderMath';
import type { CspCapitalContext } from './tastytrade-client';

export interface CspOrderRequest {
  strike: number;
  creditPerContract: number;
  quantity: number;
}

export type CspOrderGuardResult =
  | { allowed: false; reason: string }
  | { allowed: true; requiredCash: number; maxLoss: number };

/**
 * `capital` must be freshly fetched (e.g. via getCspCapitalContext) at or
 * just before call time -- passing a capital context resolved when the
 * modal first opened defeats the point of this gate.
 */
export function guardCspOrder(capital: CspCapitalContext, request: CspOrderRequest): CspOrderGuardResult {
  if (!capital.accountSelected) {
    return { allowed: false, reason: 'Account capital could not be verified. Refresh your broker connection before placing this order.' };
  }
  const requiredCash = request.strike * 100 * request.quantity;
  const available = Math.min(capital.optionBuyingPower ?? 0, capital.cashBalance ?? 0);
  if (requiredCash > available) {
    // Name both inputs and which one limits, so the figure can be reconciled against the balances shown elsewhere.
    // cashBalance here is the broker's cash-available-to-withdraw (falling back to cash-balance), not the dashboard's Cash Balance.
    const money = (n: number | null) => (n == null ? 'not reported' : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    const limiter = (capital.optionBuyingPower ?? 0) <= (capital.cashBalance ?? 0) ? 'option buying power' : 'cash available to withdraw';
    return {
      allowed: false,
      reason: `Requires $${requiredCash.toLocaleString()} in cash-secured collateral, $${Math.max(0, available).toLocaleString()} available. Limited by ${limiter} (option buying power ${money(capital.optionBuyingPower)}; cash available to withdraw ${money(capital.cashBalance)}).`,
    };
  }
  const maxLoss = computeCspMaxLoss(request.strike, request.creditPerContract, request.quantity);
  return { allowed: true, requiredCash, maxLoss };
}

export type SubmitCspOrderResult<T> =
  | { submitted: true; result: T }
  | { submitted: false; reason: string };

export async function submitCspOrderIfSafe<T>(
  capital: CspCapitalContext,
  request: CspOrderRequest,
  submitToBroker: () => Promise<T>,
): Promise<SubmitCspOrderResult<T>> {
  const guard = guardCspOrder(capital, request);
  if (!guard.allowed) return { submitted: false, reason: guard.reason };
  const result = await submitToBroker();
  return { submitted: true, result };
}
