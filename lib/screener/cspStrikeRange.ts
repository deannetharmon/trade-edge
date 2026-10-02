// lib/screener/cspStrikeRange.ts

// CSP-STRIKE-RANGE-0001 -- post-scan strike review filter for CSP results.
// Offered only when the scan returned exactly one ticker: a dollar strike
// range across mixed underlyings would silently keep one and drop another.
// The inputs start at the scan's lowest and highest strike. A blank bound is
// open, so min-only keeps everything at or above it, max-only everything at
// or below it, and both keep the inclusive range between them.
import type { ScreenResult } from '@/lib/scans/types';

export interface StrikeRange {
  min: number | null;
  max: number | null;
}

export interface StrikeBounds {
  min: number;
  max: number;
}

/** Lowest and highest CSP short strike, or null unless the results hold exactly one ticker. */
export function deriveSingleTickerStrikeBounds(results: ScreenResult[]): StrikeBounds | null {
  const symbols = new Set(results.map(r => r.symbol));
  if (symbols.size !== 1) return null;
  const strikes = results
    .map(r => (r.bestCandidate?.strategy === 'CSP' ? r.bestCandidate.shortStrike : null))
    .filter((s): s is number => s != null && Number.isFinite(s));
  if (strikes.length === 0) return null;
  return { min: Math.min(...strikes), max: Math.max(...strikes) };
}

/** Blank or non-numeric input is an open bound. */
export function parseStrikeInput(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function passesStrikeRange(strike: number, range: StrikeRange | null): boolean {
  if (!range) return true;
  if (range.min != null && strike < range.min) return false;
  if (range.max != null && strike > range.max) return false;
  return true;
}

/** True only when the range actually excludes part of the scan's strikes. */
export function isStrikeRangeNarrowing(range: StrikeRange | null, bounds: StrikeBounds | null): boolean {
  if (!range || !bounds) return false;
  return (range.min != null && range.min > bounds.min) || (range.max != null && range.max < bounds.max);
}

export function formatStrikeRangeLabel(range: StrikeRange): string {
  const fmt = (n: number) => `$${n}`;
  if (range.min != null && range.max != null) return `Strike ${fmt(range.min)}–${fmt(range.max)}`;
  if (range.min != null) return `Strike ≥ ${fmt(range.min)}`;
  return `Strike ≤ ${fmt(range.max as number)}`;
}
