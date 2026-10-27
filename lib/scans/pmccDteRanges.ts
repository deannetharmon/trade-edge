export interface PmccDteRanges {
  shortMin: number;
  shortMax: number;
  longMin: number;
  longMax: number;
}

// shortMin is 30, not 21: a short call opened at 21 DTE is already at the 21-DTE management stop
// on day one. longMin/longMax are the wide bounds for recognizing and evaluating LEAPS already
// held; the narrower default for NEW LEAPS entries lives in leapsEntryTargets.ts.
export const DEFAULT_PMCC_DTE_RANGES: PmccDteRanges = {
  shortMin: 30,
  shortMax: 45,
  longMin: 180,
  longMax: 730,
};

/**
 * PMCC-HELD-UNDERWATER-0001B (Dean): the held-LEAP short-call scan opens at 7-10 DTE (weekly income calls).
 * New-entry PMCC logic keeps DEFAULT_PMCC_DTE_RANGES (30-45). The trader can change the range before each scan.
 */
export const DEFAULT_HELD_PMCC_SHORT_DTE = { min: 7, max: 10 } as const;

/** Held-LEAP scan opens at delta 0-.15 (at most about a 15% chance of assignment) so the LEAP is rarely called away. */
export const DEFAULT_HELD_PMCC_SHORT_DELTA = { min: 0, max: 0.15 } as const;

/**
 * Quick-select presets for the held-LEAP scan's short DTE range. Every chip overlaps the next one
 * (7-10 sits inside 7-14, 7-14 meets 10-21 at 10-14, 10-21 meets 21-45 at 21, 21-45 contains 30-45).
 */
export const HELD_PMCC_SHORT_DTE_PRESETS = [
  { label: '7–10', min: 7, max: 10 },
  { label: '7–14', min: 7, max: 14 },
  { label: '10–21', min: 10, max: 21 },
  { label: '21–45', min: 21, max: 45 },
  { label: '30–45', min: 30, max: 45 },
] as const;

export function isValidPmccDteRanges(ranges: PmccDteRanges): boolean {
  return Object.values(ranges).every(value => Number.isFinite(value) && value >= 0)
    && ranges.shortMin <= ranges.shortMax
    && ranges.longMin <= ranges.longMax;
}

export function classifyPmccDte(dte: number, ranges: PmccDteRanges): {
  isShortWindow: boolean;
  isLongWindow: boolean;
} {
  return {
    isShortWindow: dte >= ranges.shortMin && dte <= ranges.shortMax,
    isLongWindow: dte >= ranges.longMin && dte <= ranges.longMax,
  };
}
