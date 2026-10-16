// lib/scans/ccOrderMath.ts

// CC-ORDERS-0001 slice A: the pure pieces of a covered-call order. No broker, no DOM, no React.
// Prices here are PER SHARE (what the broker takes), the same units rule as CSP-UNITS-0001.
//
// A covered call is a single Sell to Open call with one contingent exit: a GTC buy-to-close at a profit target.
// There is deliberately NO stop order (Ian): assignment is an acceptable outcome for a covered call, so the
// 2x-credit stop and 21-DTE management do not apply (DECIDE-0001). buildCreditEntryOtoco always adds a stop, so
// it is not reused here.

export interface CcOrderLeg {
  'instrument-type': 'Equity Option' | 'Index Option';
  symbol: string;
  quantity: number;
  action: 'Sell to Open';
  [key: string]: unknown;
}

export type BuildCcOrderLegResult = { ok: true; leg: CcOrderLeg } | { ok: false; reason: string };

export function buildCcOrderLeg(occSymbol: string | null | undefined, quantity: number, isIndex: boolean): BuildCcOrderLegResult {
  if (!occSymbol) return { ok: false, reason: 'The option symbol is not available for this call. Look it up again.' };
  if (!Number.isInteger(quantity) || quantity < 1) return { ok: false, reason: 'Quantity must be a positive whole number.' };
  return { ok: true, leg: { 'instrument-type': isIndex ? 'Index Option' : 'Equity Option', symbol: occSymbol, quantity, action: 'Sell to Open' } };
}

/** The GTC buy-to-close price for a profit target: entry x (1 - pct/100), to the cent, never below one tick. */
export function ccProfitBuyback(entryPerShare: number, profitPct: number): number {
  if (!Number.isFinite(entryPerShare) || entryPerShare <= 0) throw new Error('Entry price must be positive');
  if (!Number.isFinite(profitPct) || profitPct <= 0 || profitPct >= 100) throw new Error('Profit target must be between 0 and 100 percent');
  return Math.max(0.01, parseFloat((entryPerShare * (1 - profitPct / 100)).toFixed(2)));
}

export interface CcEntryOtoInput {
  entryPerShare: number;
  profitBuybackPerShare: number;
  quantity: number;
  leg: { action: string; quantity: number; [key: string]: unknown };
}

/**
 * One broker request: the entry (Sell to Open, GTC Limit, Credit) that triggers one contingent exit (Buy to Close,
 * GTC Limit, Debit). Same field conventions as buildCreditEntryOtoco, minus the stop.
 */
export function buildCreditEntryOto(input: CcEntryOtoInput) {
  if (!Number.isInteger(input.quantity) || input.quantity < 1) throw new Error('Entry quantity must be at least one contract');
  if (!Number.isFinite(input.entryPerShare) || input.entryPerShare <= 0) throw new Error('Entry price must be positive');
  if (!Number.isFinite(input.profitBuybackPerShare) || input.profitBuybackPerShare <= 0) throw new Error('Exit price must be positive');
  if (input.profitBuybackPerShare >= input.entryPerShare) throw new Error('Profit target must close below the entry credit');
  if (input.leg.action !== 'Sell to Open') throw new Error('A covered call opens with Sell to Open');

  const opening = Object.assign({}, input.leg, { quantity: input.quantity });
  const closing = Object.assign({}, input.leg, { quantity: input.quantity, action: 'Buy to Close' });
  return {
    type: 'OTO' as const,
    'trigger-order': {
      'time-in-force': 'GTC',
      'order-type': 'Limit',
      price: input.entryPerShare.toFixed(2),
      'price-effect': 'Credit',
      legs: [opening],
    },
    orders: [
      {
        'time-in-force': 'GTC',
        'order-type': 'Limit',
        price: input.profitBuybackPerShare.toFixed(2),
        'price-effect': 'Debit',
        legs: [closing],
      },
    ],
  };
}

export interface CcAssignmentInput {
  strike: number;
  creditPerShare: number;
  /** Per-share broker cost basis, or null when unknown or incomplete. */
  costBasis: number | null;
  quantity: number;
}

export interface CcAssignmentResult {
  /** Cash received if the shares are called away: strike x 100 x contracts. */
  proceeds: number;
  /** Premium kept either way: credit x 100 x contracts. */
  premium: number;
  /** (strike - cost basis) x 100 x contracts, before premium. Null when the cost basis is unknown. */
  gainVsCostBasis: number | null;
  /** The same including the premium kept. Null when the cost basis is unknown. */
  gainVsCostBasisWithPremium: number | null;
  /** The strike is below the cost basis, so assignment sells the shares for less than they cost. */
  belowCostBasis: boolean;
}

export function computeCcAssignment(input: CcAssignmentInput): CcAssignmentResult {
  if (!Number.isFinite(input.strike) || input.strike <= 0) throw new Error('strike must be a positive number');
  if (!Number.isFinite(input.creditPerShare) || input.creditPerShare < 0) throw new Error('credit must be zero or positive');
  if (!Number.isInteger(input.quantity) || input.quantity < 1) throw new Error('quantity must be a positive whole number');
  const shares = 100 * input.quantity;
  const premium = Math.round(input.creditPerShare * shares * 100) / 100;
  const basis = input.costBasis !== null && Number.isFinite(input.costBasis) && input.costBasis > 0 ? input.costBasis : null;
  const gain = basis === null ? null : Math.round((input.strike - basis) * shares * 100) / 100;
  return {
    proceeds: Math.round(input.strike * shares * 100) / 100,
    premium,
    gainVsCostBasis: gain,
    gainVsCostBasisWithPremium: gain === null ? null : Math.round((gain + premium) * 100) / 100,
    belowCostBasis: basis !== null && input.strike < basis,
  };
}
