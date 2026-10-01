// lib/indicators/rsiEntrySettings.ts

// RSI-ENTRY-0001 slice A2a: the trader-facing "Entry timing (RSI)" setting for one scan, its validation, and the
// receipt sentence. Pure. The gate itself lives in rsiEntryGate.ts; this only says what the trader chose.
//
// One setting per scan: On/Off plus the dip level (CSP) or peak level (CC), and an advanced turn rule (window, lift,
// ceiling or floor). Defaults are the ticket values and ship Off.

import { RSI_ENTRY_PARAMS, type EntryGateStrategy } from './rsiEntryGate';
import type { RsiTurnParams } from './rsiTurn';

export interface RsiEntrySettings {
  on: boolean;
  /** CSP: the dip level (RSI at or below this within the window). CC: the peak level (at or above this). */
  level: number;
  /** Number of latest RSI values examined. */
  window: number;
  /** Points of lift off the dip (CSP) or drop off the peak (CC). */
  lift: number;
  /** CSP: the turn must still be below this. CC: the turn must still be above this. */
  mid: number;
}

export type RsiEntryField = 'level' | 'window' | 'lift' | 'mid';

export const RSI_ENTRY_DEFAULTS: Record<EntryGateStrategy, RsiEntrySettings> = {
  CSP: { on: false, level: RSI_ENTRY_PARAMS.CSP.low, window: RSI_ENTRY_PARAMS.CSP.window, lift: RSI_ENTRY_PARAMS.CSP.lift, mid: RSI_ENTRY_PARAMS.CSP.mid },
  CC: { on: false, level: RSI_ENTRY_PARAMS.CC.high, window: RSI_ENTRY_PARAMS.CC.window, lift: RSI_ENTRY_PARAMS.CC.lift, mid: RSI_ENTRY_PARAMS.CC.mid },
};

/** A fresh copy of the defaults (Off). */
export function defaultRsiEntrySettings(strategy: EntryGateStrategy): RsiEntrySettings {
  return { ...RSI_ENTRY_DEFAULTS[strategy] };
}

/** The gate parameters for a strategy from the trader's setting. The unused side keeps the RSI-TURN default. */
export function rsiEntryParams(strategy: EntryGateStrategy, settings: RsiEntrySettings): RsiTurnParams {
  const base = RSI_ENTRY_PARAMS[strategy];
  return strategy === 'CSP'
    ? { ...base, low: settings.level, window: settings.window, lift: settings.lift, mid: settings.mid }
    : { ...base, high: settings.level, window: settings.window, lift: settings.lift, mid: settings.mid };
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Structural check, used by the stored rule snapshot validator (fails closed on anything malformed). */
export function isRsiEntrySettings(value: unknown): value is RsiEntrySettings {
  if (value == null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.on === 'boolean' && finite(v.level) && finite(v.window) && finite(v.lift) && finite(v.mid);
}

/** One message per invalid field; empty when the setting is usable. */
export function rsiEntryFieldErrors(strategy: EntryGateStrategy, s: RsiEntrySettings): Partial<Record<RsiEntryField, string>> {
  const errors: Partial<Record<RsiEntryField, string>> = {};
  if (!finite(s.mid) || s.mid < 30 || s.mid > 70) errors.mid = 'Enter a level from 30 to 70.';
  if (!finite(s.level)) errors.level = 'Enter a number.';
  else if (strategy === 'CSP') {
    if (s.level < 5 || s.level > 60) errors.level = 'Dip level must be from 5 to 60.';
    else if (finite(s.mid) && s.level >= s.mid) errors.level = 'Dip level must be below the ceiling.';
  } else {
    if (s.level < 40 || s.level > 95) errors.level = 'Peak level must be from 40 to 95.';
    else if (finite(s.mid) && s.level <= s.mid) errors.level = 'Peak level must be above the floor.';
  }
  if (!finite(s.window) || !Number.isInteger(s.window) || s.window < 3 || s.window > 30) errors.window = 'Window must be a whole number from 3 to 30 bars.';
  if (!finite(s.lift) || s.lift < 1 || s.lift > 20) errors.lift = 'Lift must be from 1 to 20 points.';
  return errors;
}

export function isRsiEntryValid(strategy: EntryGateStrategy, s: RsiEntrySettings): boolean {
  return Object.keys(rsiEntryFieldErrors(strategy, s)).length === 0;
}

export interface RsiEntryCounts {
  pass: number;
  total: number;
}

/**
 * The scan-summary and receipt sentence. "Off" is always stated, so a forgotten setting cannot hide. The turn rule is
 * only spelled out when it differs from the default, so the usual line stays short.
 */
export function rsiEntrySummary(strategy: EntryGateStrategy, s: RsiEntrySettings, counts: RsiEntryCounts | null = null): string {
  if (!s.on) return 'RSI timing: Off';
  const d = RSI_ENTRY_DEFAULTS[strategy];
  const parts = [strategy === 'CSP' ? `dip at or below ${s.level}` : `peak at or above ${s.level}`];
  if (s.window !== d.window || s.lift !== d.lift || s.mid !== d.mid) {
    parts.push(`turn rule: ${s.window} bars, lift ${s.lift}, ${strategy === 'CSP' ? 'below' : 'above'} ${s.mid}`);
  }
  if (counts) parts.push(`${counts.pass} of ${counts.total} pass`);
  return `RSI timing: On · ${parts.join(' · ')}`;
}
