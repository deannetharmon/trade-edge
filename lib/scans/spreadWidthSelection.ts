import type { SpreadCandidate } from './types';

export const SPREAD_WIDTH_CHOICES = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50] as const;

export interface SpreadWidthRange { min: number; max: number }
export const DEFAULT_SPREAD_WIDTH_RANGE: SpreadWidthRange = { min: 5, max: 50 };

export function scanWidths(range: SpreadWidthRange): number[] {
  if (!SPREAD_WIDTH_CHOICES.includes(range.min as typeof SPREAD_WIDTH_CHOICES[number]) ||
      !SPREAD_WIDTH_CHOICES.includes(range.max as typeof SPREAD_WIDTH_CHOICES[number]) || range.min > range.max) {
    throw new Error('Scan widths must be between $5 and $50 in $5 increments, with minimum no greater than maximum.');
  }
  return SPREAD_WIDTH_CHOICES.filter(width => width >= range.min && width <= range.max);
}

export function matchesDisplayedWidth(candidate: SpreadCandidate | null, width: number | null): boolean {
  if (width == null) return true;
  return candidate?.spreadWidth === width && (candidate.strategy !== 'IC' || candidate.callWidth === width);
}
