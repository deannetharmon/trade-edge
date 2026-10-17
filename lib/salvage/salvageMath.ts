// lib/salvage/salvageMath.ts
//
// SALVAGE-0001 slice A -- pure math, no UI, no broker calls.
//
// Everything here is "dollars from today": cash received now plus the payoff
// at expiry. The original debit is context only (pnlFromEntry). Hold is the
// payoff AT EXPIRY; no remaining time value is modeled (Alan).
//
// Puts: the wing is a LOWER strike put sold against the held long put.
// Calls mirror: the wing is a HIGHER strike call sold against the held long call.

import {
  OPEN_COMMISSION_PER_CONTRACT,
  REG_CLEARING_FEE_PER_CONTRACT_PER_LEG,
} from '@/lib/portfolio/rollExplanation';

export type OptionRight = 'P' | 'C';

export interface LongLeg {
  right: OptionRight;
  strike: number;
  quantity: number;
  /** Bid per share (what closing now would receive). */
  bid: number;
  /** Total dollars originally paid for the position (context only). */
  entryDebit: number;
}

export interface WingCandidate {
  strike: number;
  /** Bid per share. Credits always use the bid, never the mid. */
  bid: number;
}

export type ObjectiveVerdict = 'can-meet' | 'partial-only' | 'cannot-meet';

function roundToCent(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Intrinsic value per share of one long option at underlying price s. */
export function intrinsicPerShare(right: OptionRight, strike: number, s: number): number {
  return right === 'P' ? Math.max(strike - s, 0) : Math.max(s - strike, 0);
}

/** Estimated fees (dollars) to sell-to-open `quantity` contracts. */
export function openFees(quantity: number): number {
  return (OPEN_COMMISSION_PER_CONTRACT + REG_CLEARING_FEE_PER_CONTRACT_PER_LEG) * quantity;
}

/** Estimated fees (dollars) to sell-to-close `quantity` contracts ($0 commission). */
export function closeFees(quantity: number): number {
  return REG_CLEARING_FEE_PER_CONTRACT_PER_LEG * quantity;
}

/** Close now: sell the long option at the bid. Cash today, nothing at expiry. */
export function closeNowCash(long: LongLeg): number {
  return roundToCent(long.bid * 100 * long.quantity - closeFees(long.quantity));
}

/** Hold: payoff at expiry only, at underlying price s. */
export function holdAtExpiry(long: LongLeg, s: number): number {
  return roundToCent(intrinsicPerShare(long.right, long.strike, s) * 100 * long.quantity);
}

export interface WingValidity {
  valid: boolean;
  reason?: string;
}

/** Defined-risk rule: wing strictly beyond the long strike, quantity no larger. */
export function validateWing(long: LongLeg, wing: WingCandidate, wingQuantity: number): WingValidity {
  if (!(wingQuantity >= 1) || !Number.isInteger(wingQuantity)) {
    return { valid: false, reason: 'Wing quantity must be a whole number of at least 1.' };
  }
  if (wingQuantity > long.quantity) {
    return { valid: false, reason: 'Wing quantity cannot exceed the long leg (risk would be undefined).' };
  }
  const beyond = long.right === 'P' ? wing.strike < long.strike : wing.strike > long.strike;
  if (!beyond) {
    return {
      valid: false,
      reason:
        long.right === 'P'
          ? 'Wing strike must be strictly below the long put.'
          : 'Wing strike must be strictly above the long call.',
    };
  }
  if (!(wing.bid > 0)) return { valid: false, reason: 'Wing has no bid.' };
  return { valid: true };
}

/** Net cash received today for selling the wing (bid, less estimated fees). */
export function wingCreditCash(wing: WingCandidate, wingQuantity: number): number {
  return roundToCent(wing.bid * 100 * wingQuantity - openFees(wingQuantity));
}

/** Most the long leg + wing can pay at expiry (payoff only, credit excluded). */
export function maxExpiryPayoff(long: LongLeg, wing: WingCandidate, wingQuantity: number): number {
  const width = Math.abs(long.strike - wing.strike);
  const beyondSlope = long.quantity - wingQuantity; // long contracts left uncovered
  // With an uncovered remainder the payoff is unbounded for calls and bounded
  // by strike for puts; quantities are equal in the standard conversion.
  if (long.right === 'C' && beyondSlope > 0) return Number.POSITIVE_INFINITY;
  if (long.right === 'P') {
    // Worst case for the underlying is 0.
    return roundToCent(
      intrinsicPerShare('P', long.strike, 0) * 100 * long.quantity -
        intrinsicPerShare('P', wing.strike, 0) * 100 * wingQuantity,
    );
  }
  return roundToCent(width * 100 * wingQuantity);
}

/** Dollars from today if the underlying finishes at s: wing credit + expiry payoff. */
export function wingTotalFromToday(
  long: LongLeg,
  wing: WingCandidate,
  wingQuantity: number,
  s: number,
): number {
  const longPayoff = intrinsicPerShare(long.right, long.strike, s) * 100 * long.quantity;
  const shortPayoff = intrinsicPerShare(long.right, wing.strike, s) * 100 * wingQuantity;
  return roundToCent(wingCreditCash(wing, wingQuantity) + longPayoff - shortPayoff);
}

/** P&L measured from the ORIGINAL entry (context): value from today minus the debit paid. */
export function pnlFromEntry(long: LongLeg, dollarsFromToday: number): number {
  return roundToCent(dollarsFromToday - long.entryDebit);
}

/**
 * The underlying price at expiry needed for the wing outcome to reach `target`
 * dollars from today. Returns:
 *  - { already: true }  if the credit alone meets the target
 *  - { price }          price needed (puts: at or below; calls: at or above)
 *  - null               if no price can reach it
 */
export function requiredUnderlying(
  long: LongLeg,
  wing: WingCandidate,
  wingQuantity: number,
  target: number,
): { already: true } | { price: number } | null {
  const f = (s: number) => wingTotalFromToday(long, wing, wingQuantity, s);
  if (f(long.right === 'P' ? long.strike : 0) >= target) {
    // Out of the money side of the long strike: only the credit remains.
    const farOtm = long.right === 'P' ? long.strike * 10 : 0;
    if (f(farOtm) >= target) return { already: true };
  }
  const hi = Math.max(long.strike, wing.strike) * 100;
  const extreme = long.right === 'P' ? 0 : hi;
  if (f(extreme) < target) return null;
  // Monotone: puts nonincreasing in s, calls nondecreasing. Bisect.
  let good = extreme; // meets target
  let bad = long.right === 'P' ? long.strike * 10 : 0; // does not meet
  for (let i = 0; i < 80; i++) {
    const mid = (good + bad) / 2;
    if (f(mid) >= target) good = mid;
    else bad = mid;
  }
  // Round toward the side that still meets the target.
  const price =
    long.right === 'P' ? Math.floor(good * 100 + 1e-6) / 100 : Math.ceil(good * 100 - 1e-6) / 100;
  return { price };
}

export interface ObjectiveResult {
  verdict: ObjectiveVerdict;
  /** Best total dollars from today reachable at expiry. */
  bestCase: number;
  required: { already: true } | { price: number } | null;
}

/**
 * can-meet: some underlying price reaches the target.
 * partial-only: no price reaches it, but the best case is positive.
 * cannot-meet: the best case is zero or less after fees.
 */
export function evaluateObjective(
  long: LongLeg,
  wing: WingCandidate,
  wingQuantity: number,
  target: number,
): ObjectiveResult {
  const extreme = long.right === 'P' ? 0 : Math.max(long.strike, wing.strike) * 100;
  const bestCase = wingTotalFromToday(long, wing, wingQuantity, extreme);
  const required = requiredUnderlying(long, wing, wingQuantity, target);
  const verdict: ObjectiveVerdict = required
    ? 'can-meet'
    : bestCase > 0
      ? 'partial-only'
      : 'cannot-meet';
  return { verdict, bestCase, required };
}
