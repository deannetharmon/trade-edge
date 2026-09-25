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
