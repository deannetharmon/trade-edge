// lib/portfolio/stockOrderBuilder.ts
//
// STOCKS-ORDERS-0001 — the equity order builder. Sell to Close only (no Buy
// to Cover in v1: Dean does not short stock directly, decided 2026-09-21).
// Body shape matches the existing convention in lib/tastytrade.ts's
// buildBullPutSpread (time-in-force / order-type / price / legs), just a
// single Equity leg instead of a multi-leg Equity Option spread.

export type StockOrderTimeInForce = 'Day' | 'GTC';
/** Decided 2026-09-21: GTC is the default time in force for stock sell orders. */
export const DEFAULT_STOCK_ORDER_TIF: StockOrderTimeInForce = 'GTC';

export interface StockSellOrderLeg {
  symbol: string;
  quantity: number;
  action: 'Sell to Close';
  'order-leg-type': 'Equity';
}

export interface StockSellOrder {
  'time-in-force': StockOrderTimeInForce;
  'order-type': 'Limit';
  price: string;
  legs: [StockSellOrderLeg];
}

export type BuildStockSellOrderResult = { ok: true; order: StockSellOrder } | { ok: false; reason: string };

export interface BuildStockSellOrderInput {
  symbol: string;
  /** Shares to sell this order. Must be a positive integer and must not exceed the caller's own safety-gate result -- this function does not itself check covered-call commitment; see stockOrderSafety.ts. */
  quantity: number;
  /** Limit price per share. Defaults to the current bid when omitted (the ticket's default for a sale). */
  limitPrice: number;
  timeInForce?: StockOrderTimeInForce;
}

export function buildStockSellOrder(input: BuildStockSellOrderInput): BuildStockSellOrderResult {
  if (!input.symbol || typeof input.symbol !== 'string') return { ok: false, reason: 'A symbol is required.' };
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) return { ok: false, reason: 'Quantity must be a positive whole number of shares.' };
  if (!Number.isFinite(input.limitPrice) || input.limitPrice <= 0) return { ok: false, reason: 'Limit price must be a positive number.' };

  return {
    ok: true,
    order: {
      'time-in-force': input.timeInForce ?? DEFAULT_STOCK_ORDER_TIF,
      'order-type': 'Limit',
      price: input.limitPrice.toFixed(2),
      legs: [{ symbol: input.symbol, quantity: input.quantity, action: 'Sell to Close', 'order-leg-type': 'Equity' }],
    },
  };
}
