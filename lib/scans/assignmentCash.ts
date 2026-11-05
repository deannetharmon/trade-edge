// lib/scans/assignmentCash.ts

// ASSIGN-CASH-0001 -- total potential assignment obligation of every short put (open positions, working orders and the
// order being ticketed) against usable cash. Pure and deterministic: no fetching, no React. Callers supply the
// inputs; any input that cannot be trusted makes the result `cannot_verify`, which blocks submit.
//
// Obligation per short put = strike x 100 x contracts. This is NOT max risk: collected premium is not netted out
// (cash-balance already contains it) and a long put is not netted against a short put (sponsor ruling, Ian 2026-11-05).

import type { PendingOrder, PositionLeg } from '@/lib/portfolio-data/types';

/** The only leg fields the check reads, so callers (and tests) need not build a whole PositionLeg. */
export type AssignmentPositionLeg = Pick<PositionLeg, 'symbol' | 'optionType' | 'strikePrice' | 'direction' | 'quantity'>;

export const DEFAULT_RESERVE_PCT = 5;
export const WARN_AT = 0.7;
export const ACKNOWLEDGE_AT = 0.9;
export const BLOCK_ABOVE = 1;

export type ReserveSetting = { kind: 'percent'; value: number } | { kind: 'fixed'; value: number };
export const DEFAULT_RESERVE: ReserveSetting = { kind: 'percent', value: DEFAULT_RESERVE_PCT };

/** A put leg the proposed order opens (adds) or closes (subtracts). */
export interface ProposedPutLeg { strike: number; contracts: number }

export interface ProposedOrder {
  /** Short puts the order sells to open. */
  opens: ProposedPutLeg[];
  /** Short puts the order buys to close (close, partial close, or the closing half of a roll). */
  closes: ProposedPutLeg[];
  /** Broker ids of working orders this order replaces, so they are not counted twice. */
  replacesOrderIds?: string[];
}

export interface AssignmentCashInput {
  cashBalance: number | null | undefined;
  reserve: ReserveSetting;
  positions: ReadonlyArray<{ legs: ReadonlyArray<AssignmentPositionLeg> }> | null | undefined;
  pendingOrders: ReadonlyArray<Pick<PendingOrder, 'id' | 'legs'>> | null | undefined;
  proposed: ProposedOrder;
  /** Margin-backed assignment setting. Off by default (DR-0001). */
  marginBackedEnabled?: boolean;
}

export type AssignmentTier = 'none' | 'warn' | 'acknowledge' | 'blocked' | 'cannot_verify';

/** What the ticket may do next. */
export type SubmitState =
  | 'allowed'
  | 'needs_acknowledgment'
  | 'needs_borrowing_confirmation'
  | 'blocked'
  | 'cannot_verify';

export interface AssignmentCashResult {
  tier: AssignmentTier;
  submit: SubmitState;
  /** Why the result is cannot_verify; empty otherwise. */
  reasons: string[];
  assignmentCashBefore: number | null;
  assignmentCashAfter: number | null;
  usableCash: number | null;
  /** usableCash - assignmentCashAfter. Positive = surplus, negative = shortfall. */
  surplusShortfall: number | null;
  /** assignmentCashAfter / usableCash, as a fraction; null when usable cash is zero or negative. */
  utilization: number | null;
  /** True when the order lowers or leaves unchanged the obligation. Such an order is never blocked. */
  reducesObligation: boolean;
  /** Amount that would be borrowed if the trader proceeds on margin; 0 when funded. */
  borrowedAmount: number;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const obligation = (strike: number, contracts: number) => strike * 100 * contracts;

const cannotVerify = (reasons: string[]): AssignmentCashResult => ({
  tier: 'cannot_verify', submit: 'cannot_verify', reasons,
  assignmentCashBefore: null, assignmentCashAfter: null, usableCash: null, surplusShortfall: null,
  utilization: null, reducesObligation: false, borrowedAmount: 0,
});

/** Usable cash after the reserve. Null when cash or the reserve setting is not a usable number. */
export function usableCashAfterReserve(cashBalance: number | null | undefined, reserve: ReserveSetting): number | null {
  if (!finite(cashBalance)) return null;
  if (!finite(reserve?.value) || reserve.value < 0) return null;
  if (reserve.kind === 'percent' && reserve.value > 100) return null;
  const amount = reserve.kind === 'percent' ? Math.max(0, cashBalance) * (reserve.value / 100) : reserve.value;
  return cashBalance - amount;
}

/** Classify utilization. Comparisons use unrounded values; 100% exactly is still the acknowledgment band. */
export function tierForUtilization(utilization: number): Exclude<AssignmentTier, 'cannot_verify'> {
  if (utilization > BLOCK_ABOVE) return 'blocked';
  if (utilization >= ACKNOWLEDGE_AT) return 'acknowledge';
  if (utilization >= WARN_AT) return 'warn';
  return 'none';
}

export function evaluateAssignmentCash(input: AssignmentCashInput): AssignmentCashResult {
  const reasons: string[] = [];

  if (!finite(input.cashBalance)) reasons.push('Cash balance unavailable');
  if (!input.positions) reasons.push('Open positions unavailable');
  if (!input.pendingOrders) reasons.push('Working orders unavailable');

  const usableCash = usableCashAfterReserve(input.cashBalance, input.reserve);
  if (finite(input.cashBalance) && usableCash == null) reasons.push('Reserve setting is invalid');

  const replaced = new Set(input.proposed.replacesOrderIds ?? []);

  let existing = 0;
  for (const position of input.positions ?? []) {
    for (const leg of position.legs ?? []) {
      if (leg.optionType !== 'P' || leg.direction !== 'Short') continue;
      const contracts = Math.abs(leg.quantity);
      if (!finite(leg.strikePrice) || !finite(leg.quantity) || contracts === 0) {
        reasons.push(`Short put ${leg.symbol ?? ''} has an unreadable strike or quantity`.replace('  ', ' '));
        continue;
      }
      existing += obligation(leg.strikePrice, contracts);
    }
  }

  for (const order of input.pendingOrders ?? []) {
    if (replaced.has(order.id)) continue;
    for (const leg of order.legs ?? []) {
      // Only working sell-to-open puts add obligation. Closing orders are ignored on purpose: until they fill, the
      // position they close is still counted above, which is the conservative reading.
      if (leg.optionType !== 'P' || !/^sell/i.test(leg.action) || !/to open/i.test(leg.action)) continue;
      const contracts = Math.abs(leg.quantity);
      // A missing quantity is never treated as 1.
      if (!finite(leg.strikePrice) || !finite(leg.quantity) || contracts === 0) {
        reasons.push(`Working order ${order.id} has a put leg with an unreadable strike or quantity`);
        continue;
      }
      existing += obligation(leg.strikePrice, contracts);
    }
  }

  let added = 0;
  for (const leg of input.proposed.opens) {
    if (!finite(leg.strike) || leg.strike <= 0 || !Number.isInteger(leg.contracts) || leg.contracts < 1) {
      reasons.push('Proposed order has an invalid strike or quantity');
      continue;
    }
    added += obligation(leg.strike, leg.contracts);
  }
  let removed = 0;
  for (const leg of input.proposed.closes) {
    if (!finite(leg.strike) || leg.strike <= 0 || !Number.isInteger(leg.contracts) || leg.contracts < 1) {
      reasons.push('Proposed order has an invalid closing strike or quantity');
      continue;
    }
    removed += obligation(leg.strike, leg.contracts);
  }

  if (reasons.length > 0 || usableCash == null) return cannotVerify(reasons.length > 0 ? reasons : ['Funding could not be verified']);

  const before = existing;
  const after = Math.max(0, existing + added - removed);
  const reducesObligation = after <= before;
  const surplusShortfall = usableCash - after;
  const utilization = usableCash > 0 ? after / usableCash : null;

  // Zero or negative usable cash: any remaining obligation is unfunded, no ratio exists.
  const tier: Exclude<AssignmentTier, 'cannot_verify'> =
    utilization == null ? (after > 0 ? 'blocked' : 'none') : tierForUtilization(utilization);

  const borrowedAmount = surplusShortfall < 0 ? -surplusShortfall : 0;

  let submit: SubmitState;
  if (reducesObligation) {
    // A trade that lowers the obligation is never blocked and never needs an acknowledgment.
    submit = 'allowed';
  } else if (tier === 'blocked') {
    submit = input.marginBackedEnabled ? 'needs_borrowing_confirmation' : 'blocked';
  } else if (tier === 'acknowledge') {
    submit = 'needs_acknowledgment';
  } else {
    submit = 'allowed';
  }

  return {
    tier, submit, reasons: [], assignmentCashBefore: before, assignmentCashAfter: after, usableCash,
    surplusShortfall, utilization, reducesObligation, borrowedAmount,
  };
}

export interface SubmitConfirmations {
  acknowledged: boolean;
  borrowingConfirmed: boolean;
}

/**
 * Submit-time decision from a freshly computed result. The caller must re-fetch balances, positions and working
 * orders immediately before calling this; a result computed when the ticket opened is not enough.
 */
export function guardAssignmentCash(
  result: AssignmentCashResult,
  confirmations: SubmitConfirmations,
): { allowed: true } | { allowed: false; reason: string } {
  switch (result.submit) {
    case 'allowed':
      return { allowed: true };
    case 'cannot_verify':
      return { allowed: false, reason: `Cannot verify funding. ${result.reasons.join('; ')}` };
    case 'needs_acknowledgment':
      return confirmations.acknowledged
        ? { allowed: true }
        : { allowed: false, reason: 'Acknowledge the assignment-cash warning before placing this order.' };
    case 'needs_borrowing_confirmation':
      return confirmations.borrowingConfirmed
        ? { allowed: true }
        : { allowed: false, reason: 'Confirm the borrowing risk before placing this order.' };
    case 'blocked':
      return { allowed: false, reason: 'Assignment cash exceeds usable cash. Enable margin-backed assignment to proceed on borrowed funds.' };
  }
}
