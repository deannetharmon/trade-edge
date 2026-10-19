// lib/portfolio/orderErrorDisplay.ts

/**
 * ORDER-ERR-0001: text shown under a rejected order in the Order Results dialog.
 *
 * Only RAW TastyTrade error codes are rewritten into plain guidance. Every
 * message TradeEdge produces itself (bracket-stop refusals, "No order was
 * cancelled", restoration warnings, price blocks) is shown exactly as written.
 *
 * Why: the old display rewrote ANY error containing the word "cancel" into
 * "The existing GTC order could not be cancelled automatically. Cancel it
 * manually...". Every TradeEdge refusal says "No order was cancelled", so the
 * real reason (and any CRITICAL restoration warning) was always hidden.
 */
export function orderErrorForDisplay(error: string, symbol: string): string {
  if (error.includes('cannot_close_against_more_than_existing')) {
    return `TastyTrade blocked this order because an existing closing order is already working on this position. Go to TastyTrade → Activity → Working Orders, cancel the existing GTC on ${symbol}, then retry here.`;
  }
  if (error.includes('cannot_update_order')) {
    return 'TastyTrade would not cancel the existing GTC order. Cancel it manually in TastyTrade first, then retry.';
  }
  return error;
}
