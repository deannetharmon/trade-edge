// lib/portfolio/stopSlider.ts
//
// STOP-SLIDER-0001: pure helpers for the stop-percentage sliders shown when a
// trader sets a stop on a position that has none.
//
// Two different meanings, kept apart on purpose:
// - CREDIT positions (spreads, iron condors, CSP, CC): the slider is the stop
//   trigger price as a percent of the ORIGINAL CREDIT. 200% = 2.0x credit,
//   which is a loss equal to 100% of the credit. The 150-300% range is the
//   same 1.5x-3x band stopLossPolicy.ts treats as ALIGNED, so a stop set from
//   the slider never lands as TOO_TIGHT or TOO_LOOSE.
// - DEBIT positions (LEAPS, long calls): the slider is the MAXIMUM LOSS as a
//   percent of the entry debit. A long option cannot lose more than 100%, and
//   a 100% stop would have a $0 trigger, so the range stops short of it.

import { protectiveStopOutcomeLabel, signedDollar } from './positionManagementPresentation';
import {
  DEFAULT_ENTRY_STOP_MULTIPLE,
  MAX_EXPLICIT_CREDIT_STOP_MULTIPLE,
  MIN_EXPLICIT_CREDIT_STOP_MULTIPLE,
} from './stopLossPolicy';

export const CREDIT_STOP_PCT_MIN = Math.round(MIN_EXPLICIT_CREDIT_STOP_MULTIPLE * 100); // 150
export const CREDIT_STOP_PCT_MAX = Math.round(MAX_EXPLICIT_CREDIT_STOP_MULTIPLE * 100); // 300
export const CREDIT_STOP_PCT_DEFAULT = Math.round(DEFAULT_ENTRY_STOP_MULTIPLE * 100); // 200
export const CREDIT_STOP_PCT_STEP = 5;

export const DEBIT_STOP_LOSS_PCT_MIN = 5;
export const DEBIT_STOP_LOSS_PCT_MAX = 95;
export const DEBIT_STOP_LOSS_PCT_DEFAULT = 50;
export const DEBIT_STOP_LOSS_PCT_STEP = 5;

export function clampSliderValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

// ── Credit positions ─────────────────────────────────────────────────────

/** Stop trigger price (per contract) for a given percent of original credit. */
export function creditStopTriggerFromPct(creditPerContract: number, pctOfCredit: number): number {
  if (!Number.isFinite(creditPerContract) || creditPerContract <= 0) throw new Error('Original credit must be positive.');
  if (!Number.isFinite(pctOfCredit) || pctOfCredit <= 0) throw new Error('Stop percentage must be positive.');
  return Number(((creditPerContract * pctOfCredit) / 100).toFixed(2));
}

/** Percent of original credit that a trigger price represents (rounded). Null if not computable. */
export function creditStopPctFromTrigger(creditPerContract: number, triggerPrice: number): number | null {
  if (!Number.isFinite(creditPerContract) || creditPerContract <= 0) return null;
  if (!Number.isFinite(triggerPrice) || triggerPrice <= 0) return null;
  return Math.round((triggerPrice / creditPerContract) * 100);
}

export function isCreditStopPctInSliderRange(pct: number): boolean {
  return Number.isFinite(pct) && pct >= CREDIT_STOP_PCT_MIN && pct <= CREDIT_STOP_PCT_MAX;
}

/** Custom-stop caption shown when the stop sits outside the slider's range. */
export const CREDIT_STOP_CUSTOM_LABEL = `Custom stop — outside the ${CREDIT_STOP_PCT_MIN}–${CREDIT_STOP_PCT_MAX}% slider range`;

/**
 * One readout for every stop, dollars first: "Stop $4.02 · loss -$201.00 (100% of credit)".
 * `pnlDollars` is the signed result if the stop fills (negative = loss).
 */
export function describeCreditStopReadout(triggerPrice: number, pctOfCredit: number | null, pnlDollars: number): string {
  const pct = pctOfCredit != null ? ` (${Math.round(pctOfCredit)}% of credit)` : '';
  return `Stop $${triggerPrice.toFixed(2)} · ${protectiveStopOutcomeLabel(pnlDollars)}${pct}`;
}

/** Add / Edit / Adjust / Review, matching the card's button, for the dialog title. */
export function stopDialogVerb(classification: string | null | undefined): 'Add' | 'Edit' | 'Adjust' | 'Review' {
  if (classification === 'NO_STOP') return 'Add';
  if (classification === 'ALIGNED') return 'Edit';
  if (classification === 'TOO_LOOSE') return 'Adjust';
  return 'Review';
}

// ── Debit positions ──────────────────────────────────────────────────────

export function isDebitStopLossPctValid(pct: number): boolean {
  return Number.isFinite(pct) && pct >= DEBIT_STOP_LOSS_PCT_MIN && pct <= DEBIT_STOP_LOSS_PCT_MAX;
}

/** Dollar loss if a debit stop fills at the trigger. */
export function debitStopLossDollars(entryDebitPerContract: number, maxLossPct: number, quantity: number): number {
  return Number(((entryDebitPerContract * maxLossPct) / 100 * quantity * 100).toFixed(2));
}

/** Same shape as the credit readout: "Stop $10.65 · loss -$1065.00 (50% of entry debit)". */
export function describeDebitStopReadout(triggerPrice: number, maxLossPct: number, lossDollars: number): string {
  return `Stop $${triggerPrice.toFixed(2)} · loss ${signedDollar(-Math.abs(lossDollars))} (${Math.round(maxLossPct)}% of entry debit)`;
}
