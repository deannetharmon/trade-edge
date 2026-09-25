// features/portfolio/positions-workspace/model/valueTone.ts
//
// Ian's color rules for the Metric Movement column, by position type (2026-09-25). Display only; nothing here feeds a recommendation.
// Colors are from the trader's side of the trade:
//   Bought options (LEAP, long call, long put, debit spread, PMCC): intrinsic up green, extrinsic up green (down red), IV up green (net vega is positive).
//   Sold options (CSP, short call, credit spread, iron condor): intrinsic up RED, extrinsic up RED (down green: the decay is the profit), IV up red (net vega is negative).
//   Exception: a lone short put set to Acquire or Wheel: intrinsic up is the plan, so intrinsic stays neutral (extrinsic keeps its color).
//   Delta, gamma, vega, IVR stay neutral: there is no clear good or bad. Theta and P/L keep their existing rules.
// A move under one cent (or one IV point-hundredth) is neutral, as everywhere else in this column.

import { comparisonTone, type SemanticTone } from './presentation';
import type { ValueSplit } from './extrinsic';

export interface ToneContext {
  split: ValueSplit;
  /** Stored intent for the position (income, acquisition, wheel, ...). */
  intent?: string | null;
  /** A lone short put or short call. */
  loneShort: boolean;
}

export function intrinsicTone(context: ToneContext): SemanticTone {
  const { split, intent, loneShort } = context;
  if (loneShort && split.side === 'short' && (intent === 'acquisition' || intent === 'wheel')) return 'neutral';
  return comparisonTone(split.intrinsic.atEntry, split.intrinsic.now, split.side === 'long');
}

export function extrinsicTone(split: ValueSplit): SemanticTone {
  return comparisonTone(split.extrinsic.atEntry, split.extrinsic.now, split.side === 'long');
}

/** IV up helps a position with positive net vega and hurts one with negative net vega; unknown vega stays neutral. */
export function ivTone(prior: number | null | undefined, current: number | null | undefined, netVega: number | null | undefined): SemanticTone {
  if (netVega == null || !Number.isFinite(netVega) || netVega === 0) return 'neutral';
  return comparisonTone(prior, current, netVega > 0);
}
