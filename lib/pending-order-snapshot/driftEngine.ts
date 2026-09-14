// lib/pending-order-snapshot/driftEngine.ts
//
// PENDING-ENTRY-DECISION-SUPPORT-0001 -- the single computation the
// recommendation number, the reasoning sentence, and the favorable/
// unfavorable badge all derive from. Quinn's explicit requirement: these
// three must never be independently computed, or they can silently
// disagree. Call this once per pending order and read every displayed
// value off the one result.
//
// Starting values, not permanently settled ones (Ian) -- revisit
// MIN_TICK_FLOOR and MIN_GAP_PCT once Dean has used this for real.

export const MIN_TICK_FLOOR = 0.10; // 2 ticks at a $0.05 options tick
export const MIN_GAP_PCT = 0.15; // 15% of the requested-vs-reference gap
export const MIN_ELAPSED_MINUTES = 30; // Ian: below this, apparent moves are more likely bid-ask bounce than real signal

export interface DriftInput {
  requestedPrice: number;
  priceEffect: 'Credit' | 'Debit';
  /** The natural-side reference price when the order was first captured. */
  referenceAtPlacement: number;
  /** The current natural-side reference price. */
  currentReference: number;
  /** Minutes since the order was placed. */
  minutesElapsed: number;
}

export type DriftDirection = 'TOWARD' | 'AWAY' | 'FLAT';

export interface DriftResult {
  /** Not enough time has passed to distinguish real drift from normal bid-ask bounce. */
  gatheringData: boolean;
  minutesRemaining: number; // 0 once gatheringData is false
  /** Absolute dollar movement of the reference since placement. */
  movedAmount: number;
  direction: DriftDirection;
  /** The harder of the two thresholds to clear, in dollars -- shown in the reasoning sentence. */
  thresholdUsed: number;
  /** True only when movedAmount clears BOTH the tick floor AND the gap percentage (AND, not OR -- Quinn's explicit correction). */
  clearsThreshold: boolean;
  /** Present only when clearsThreshold is true; the badge/sentence must never show a verdict on a sub-threshold move. */
  favorability: 'MORE_FAVORABLE' | 'LESS_FAVORABLE' | null;
  /** The gap between requested price and current reference, halved -- the recommended reprice when clearsThreshold is true. Null while gatheringData or when not clearing threshold (the existing KEEP_WORKING case owns those states). */
  recommendedPrice: number | null;
}

export function computeDrift(input: DriftInput): DriftResult {
  if (input.minutesElapsed < MIN_ELAPSED_MINUTES) {
    return {
      gatheringData: true,
      minutesRemaining: Math.ceil(MIN_ELAPSED_MINUTES - input.minutesElapsed),
      movedAmount: 0,
      direction: 'FLAT',
      thresholdUsed: MIN_TICK_FLOOR,
      clearsThreshold: false,
      favorability: null,
      recommendedPrice: null,
    };
  }

  const gap = Math.abs(input.requestedPrice - input.currentReference);
  const gapThreshold = gap * MIN_GAP_PCT;
  // "Whichever is the harder bar to clear" -- the larger of the two.
  const thresholdUsed = Math.max(MIN_TICK_FLOOR, gapThreshold);

  const rawMove = input.currentReference - input.referenceAtPlacement;
  const movedAmount = Math.abs(rawMove);

  // Direction is relative to the trader's own requested price, not raw
  // sign -- for a Credit order the reference rising toward the ask is
  // favorable; for a Debit order the reference falling toward the ask is
  // favorable. Comparing distance-to-ask before and after normalizes this
  // without needing separate credit/debit branches downstream.
  const distanceBefore = Math.abs(input.requestedPrice - input.referenceAtPlacement);
  const distanceAfter = Math.abs(input.requestedPrice - input.currentReference);
  const direction: DriftDirection =
    movedAmount === 0 ? 'FLAT' : distanceAfter < distanceBefore ? 'TOWARD' : 'AWAY';

  const clearsThreshold = movedAmount >= MIN_TICK_FLOOR && movedAmount >= gapThreshold;

  return {
    gatheringData: false,
    minutesRemaining: 0,
    movedAmount,
    direction,
    thresholdUsed,
    clearsThreshold,
    favorability: clearsThreshold ? (direction === 'TOWARD' ? 'MORE_FAVORABLE' : 'LESS_FAVORABLE') : null,
    recommendedPrice: clearsThreshold
      ? Math.round(((input.requestedPrice + input.currentReference) / 2) * 100) / 100
      : null,
  };
}
