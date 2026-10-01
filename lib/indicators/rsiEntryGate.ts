// lib/indicators/rsiEntryGate.ts

// RSI-ENTRY-0001 slice A1: the entry-timing gate. Maps the existing Wilder RSI (rsi.ts) and turn state (rsiTurn.ts)
// to PASS / WAIT / UNAVAILABLE with a plain reason and the chip text from Diane's mock.
//
// It adds NO second RSI implementation and does not touch RSI_TURN_PARAMS. Pure and fail-closed: anything unusable
// (too few closes, bad values, invalid parameters) is UNAVAILABLE, never a guess and never a pass.
//
// CSP (sell puts): PASS = rsiState is TURNING_UP with the CSP parameters, that is all of: the lowest RSI of the last
//   `window` values is at or below `low` (a dip); the latest RSI is at least `lift` above that low; the latest RSI is
//   below `mid` (not chased); and the latest two moves are both rises.
// CC (sell calls): the mirror image with `high`; PASS = TURNING_DOWN.
// Boundaries are inherited from rsiState: at-or-below the dip, at-or-above the lift, strictly below the ceiling,
// strict rises (a flat bar breaks the run).
//
// The reason for a WAIT is computed from the same window the state uses, so the label always agrees with the verdict.
// An entry timing hint, never a signal and never a reversal call.

import { rsiSeries } from './rsi';
import { describeRsiTurn, rsiState, type RsiTurnParams } from './rsiTurn';

export type EntryGateStrategy = 'CSP' | 'CC';
export type EntryGateVerdict = 'PASS' | 'WAIT' | 'UNAVAILABLE';
export type EntryGateReason =
  | 'TURNED_UP' | 'NO_DIP' | 'STILL_FALLING' | 'BOUNCED'
  | 'TURNED_DOWN' | 'NO_PEAK' | 'STILL_RISING' | 'FADED'
  | 'TURN_NOT_CONFIRMED'
  | 'UNAVAILABLE';

/**
 * Gate parameters per strategy (Ian and Alan, 2026-10-01). CSP uses `low` as the dip level; CC uses `high` as the peak
 * level. The unused side keeps the RSI-TURN-0001 default so the object is a complete RsiTurnParams.
 */
export const RSI_ENTRY_PARAMS: Record<EntryGateStrategy, RsiTurnParams> = {
  CSP: { low: 40, high: 70, window: 8, lift: 3, mid: 50 },
  CC: { low: 30, high: 60, window: 8, lift: 3, mid: 50 },
};

export interface RsiEntryGateResult {
  verdict: EntryGateVerdict;
  reason: EntryGateReason;
  /** Chip text: "RSI 36 · turned up from 28, 2 bars ago", "Wait · no dip (RSI 58)", or "RSI n/a". */
  label: string;
  /** Latest RSI, unrounded; null when unavailable. */
  latest: number | null;
  /** Window low (CSP) or window high (CC); null when unavailable. */
  extreme: number | null;
  /** Bars between that extreme and the latest bar; null when unavailable. */
  extremeBarsAgo: number | null;
}

const REASON_TEXT: Record<Exclude<EntryGateReason, 'TURNED_UP' | 'TURNED_DOWN' | 'UNAVAILABLE'>, string> = {
  NO_DIP: 'no dip',
  STILL_FALLING: 'still falling',
  BOUNCED: 'bounced',
  NO_PEAK: 'no peak',
  STILL_RISING: 'still rising',
  FADED: 'faded',
  TURN_NOT_CONFIRMED: 'turn not confirmed',
};

const UNAVAILABLE: RsiEntryGateResult = {
  verdict: 'UNAVAILABLE',
  reason: 'UNAVAILABLE',
  label: 'RSI n/a',
  latest: null,
  extreme: null,
  extremeBarsAgo: null,
};

function validParams(params: RsiTurnParams): boolean {
  const { low, high, window, lift, mid } = params ?? ({} as RsiTurnParams);
  return [low, high, lift, mid].every((v) => typeof v === 'number' && Number.isFinite(v))
    && Number.isInteger(window) && window >= 3
    && lift >= 0;
}

/** Gate verdict from an RSI series (oldest first, latest last), for callers that already have the series. */
export function evaluateRsiEntryGateFromSeries(
  strategy: EntryGateStrategy,
  rsi: unknown,
  params: RsiTurnParams = RSI_ENTRY_PARAMS[strategy],
): RsiEntryGateResult {
  if (strategy !== 'CSP' && strategy !== 'CC') return UNAVAILABLE;
  if (!validParams(params)) return UNAVAILABLE;
  const state = rsiState(rsi, params);
  if (state === 'INSUFFICIENT') return UNAVAILABLE;

  const series = rsi as number[];
  const w = series.slice(series.length - params.window);
  const latest = w[w.length - 1];
  const wantLow = strategy === 'CSP';
  const extreme = wantLow ? Math.min(...w) : Math.max(...w);
  const extremeBarsAgo = w.length - 1 - w.lastIndexOf(extreme);

  const pass = wantLow ? state === 'TURNING_UP' : state === 'TURNING_DOWN';
  if (pass) {
    return {
      verdict: 'PASS',
      reason: wantLow ? 'TURNED_UP' : 'TURNED_DOWN',
      label: describeRsiTurn({ state, latest, extreme, extremeBarsAgo, series }),
      latest,
      extreme,
      extremeBarsAgo,
    };
  }

  let reason: Exclude<EntryGateReason, 'TURNED_UP' | 'TURNED_DOWN' | 'UNAVAILABLE'>;
  if (wantLow) {
    if (extreme > params.low) reason = 'NO_DIP';
    else if (latest < extreme + params.lift) reason = 'STILL_FALLING';
    else if (latest >= params.mid) reason = 'BOUNCED';
    else reason = 'TURN_NOT_CONFIRMED';
  } else {
    if (extreme < params.high) reason = 'NO_PEAK';
    else if (latest > extreme - params.lift) reason = 'STILL_RISING';
    else if (latest <= params.mid) reason = 'FADED';
    else reason = 'TURN_NOT_CONFIRMED';
  }
  return {
    verdict: 'WAIT',
    reason,
    label: `Wait · ${REASON_TEXT[reason]} (RSI ${Math.round(latest)})`,
    latest,
    extreme,
    extremeBarsAgo,
  };
}

/** Gate verdict from daily closes (oldest first, completed bars only; see completedBars.ts). */
export function evaluateRsiEntryGate(
  strategy: EntryGateStrategy,
  closes: unknown,
  params: RsiTurnParams = RSI_ENTRY_PARAMS[strategy],
): RsiEntryGateResult {
  const series = rsiSeries(closes);
  if (!series) return UNAVAILABLE;
  return evaluateRsiEntryGateFromSeries(strategy, series, params);
}

export interface EntryGateOverrideWording {
  /** The one neutral line in the order window. */
  line: string;
  /** The audit text stored with the entry and shown in the Trade Log. */
  audit: string;
}

/**
 * Wording for placing a trade that is not a Pass (the trader proceeds anyway). Null for a Pass: nothing to say.
 * Same words as the chip: Wait, and "n/a" for no usable RSI.
 */
export function describeEntryGateOverride(result: RsiEntryGateResult | null | undefined): EntryGateOverrideWording | null {
  if (!result || result.verdict === 'PASS') return null;
  if (result.verdict === 'UNAVAILABLE' || result.latest == null || result.reason === 'UNAVAILABLE') {
    return { line: 'RSI timing: n/a (not enough price history). Placing anyway.', audit: 'Entered with RSI gate = n/a' };
  }
  const why = REASON_TEXT[result.reason as keyof typeof REASON_TEXT] ?? 'not turned';
  return {
    line: `RSI timing: Wait (${why}, RSI ${Math.round(result.latest)}). Placing anyway.`,
    audit: `Entered with RSI gate = Wait (${why})`,
  };
}
