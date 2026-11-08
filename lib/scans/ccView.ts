// lib/scans/ccView.ts

// CC-SIMPLIFY-0001 Phase 2 -- the covered-call scan only FETCHES (tickers + DTE). Delta range and bid/ask width are a
// VIEW over the calls the scan kept: changing them re-picks the best call from the same pool, with no rescan.
// Pure. Parity by construction: the view re-runs the SAME finder (findBestCoveredCall + the closest-call fallback, via
// the page's runCcChecklist) on a pool that holds every call the safety gates let through, so a pick under the default
// view equals the pick the old pre-scan rules produced. Safety gates (strike floor, usable quote, real open interest,
// earnings, share capacity) are never part of the view.

import type { WheelChainLeg } from '@/lib/wheel/chainSearch';
import { DEFAULT_CC_RULES, type CcRulesType } from './constants';
import { ccLegRejection, type CcEligibilityParams } from './covered-call-finder';
import { ccStrikeFloor } from './ccStrikeFloor';
import type { CoveredCallCapacity } from './covered-call-capacity';

export type CcViewPresetKey = 'upside' | 'balanced' | 'income' | 'atm' | 'custom';

/** The view-side controls. Open interest keeps its existing results chip; it is not part of this view. */
export interface CcView {
  preset: CcViewPresetKey;
  deltaMin: number;
  deltaMax: number;
  /** Max bid/ask width, percent of mid. */
  widthPctMax: number;
  /** Absolute width ceiling, dollars per share (fixed; shown, not a chip). */
  widthCeiling: number;
}

export const CC_VIEW_PRESETS: Array<{ key: Exclude<CcViewPresetKey, 'custom'>; label: string; deltaMin: number; deltaMax: number }> = [
  { key: 'upside', label: 'Keep more upside', deltaMin: 0.10, deltaMax: 0.20 },
  { key: 'balanced', label: 'Balanced', deltaMin: 0.20, deltaMax: 0.35 },
  { key: 'income', label: 'More income', deltaMin: 0.30, deltaMax: 0.40 },
  // Ian: for a trader who expects a dip and wants the most premium, accepting assignment near today's price.
  { key: 'atm', label: 'At the money', deltaMin: 0.45, deltaMax: 0.55 },
];

/** Max-width chip choices (percent of mid). The default is the old pre-scan value, DEFAULT_CC_RULES.WIDTH_PCT_MAX. */
export const CC_WIDTH_CHOICES = [5, 10, 15] as const;

/** The default view: exactly today's pre-scan rules (delta .20-.35, width 10%, ceiling $0.50). */
export const DEFAULT_CC_VIEW: CcView = {
  preset: 'balanced',
  deltaMin: DEFAULT_CC_RULES.DELTA_MIN,
  deltaMax: DEFAULT_CC_RULES.DELTA_MAX,
  widthPctMax: DEFAULT_CC_RULES.WIDTH_PCT_MAX,
  widthCeiling: DEFAULT_CC_RULES.WIDTH_CEILING,
};

export function detectCcPreset(v: Pick<CcView, 'deltaMin' | 'deltaMax'>): CcViewPresetKey {
  return CC_VIEW_PRESETS.find(p => p.deltaMin === v.deltaMin && p.deltaMax === v.deltaMax)?.key ?? 'custom';
}

export function ccViewFromPreset(key: Exclude<CcViewPresetKey, 'custom'>, base: CcView = DEFAULT_CC_VIEW): CcView {
  const p = CC_VIEW_PRESETS.find(x => x.key === key) ?? CC_VIEW_PRESETS[1];
  return { ...base, preset: p.key, deltaMin: p.deltaMin, deltaMax: p.deltaMax };
}

/** A view with a changed delta or width; the preset label follows the numbers. */
export function ccViewWith(view: CcView, patch: Partial<Pick<CcView, 'deltaMin' | 'deltaMax' | 'widthPctMax'>>): CcView {
  const next = { ...view, ...patch };
  return { ...next, preset: detectCcPreset(next) };
}

/** Wide-open grading for the SCAN: the view, not the scan, decides what delta and width hide. DTE and OI_MIN pass through. */
export const CC_SCAN_WIDE = { DELTA_MIN: 0.01, DELTA_MAX: 0.99, WIDTH_PCT_MAX: 1_000_000, WIDTH_CEILING: 1_000_000 } as const;

export function ccScanRules(base: CcRulesType): CcRulesType {
  return { ...base, ...CC_SCAN_WIDE };
}

/** The finder rules for a view (scan DTE and OI minimum unchanged). */
export function ccViewRules(base: CcRulesType, view: CcView): CcRulesType {
  return { ...base, DELTA_MIN: view.deltaMin, DELTA_MAX: view.deltaMax, WIDTH_PCT_MAX: view.widthPctMax, WIDTH_CEILING: view.widthCeiling };
}

export interface CcPool {
  expirations: string[];
  /** Every call that passes the view-independent gates, by expiration. */
  chains: Record<string, WheelChainLeg[]>;
}

/**
 * The calls a view could ever show: every call in the chain that no view-independent gate rejects (call leg, usable
 * delta and strike, real open interest, at or above the strike floor, two-sided uncrossed quote). Delta and width are
 * left open. Earnings and capacity are applied by the finder per pick, so they are not pooled away here.
 * Fails closed: no known price or cost basis means no floor and an empty pool, as in the finder.
 */
export function buildCcPool(
  chain: { expirations: string[]; chains: Record<string, WheelChainLeg[]> },
  input: { dteMin: number; dteMax: number; stockPrice: number | null; costBasis: number | null; allowBelowBasis?: boolean; today?: Date },
): CcPool {
  const floor = ccStrikeFloor(input.stockPrice, input.costBasis, { allowBelowBasis: input.allowBelowBasis === true }).floor;
  const chains: Record<string, WheelChainLeg[]> = {};
  if (floor === null) return { expirations: chain.expirations, chains };
  const wide: CcEligibilityParams = {
    deltaTarget: { min: CC_SCAN_WIDE.DELTA_MIN, max: CC_SCAN_WIDE.DELTA_MAX },
    dteTarget: { min: input.dteMin, max: input.dteMax },
    minStrike: floor,
    oiMin: 0,
    widthPctMax: CC_SCAN_WIDE.WIDTH_PCT_MAX,
    widthCeiling: CC_SCAN_WIDE.WIDTH_CEILING,
  };
  for (const expiration of chain.expirations) {
    const dte = daysUntil(expiration, input.today);
    if (dte < input.dteMin || dte > input.dteMax) continue;
    const kept = (chain.chains[expiration] ?? []).filter(leg => ccLegRejection(leg, dte, wide) === null);
    if (kept.length > 0) chains[expiration] = kept;
  }
  return { expirations: chain.expirations, chains };
}

/** Everything the results screen needs to re-pick one ticker's best call for a new view, with no rescan. */
export interface CcRegradeInput {
  pool: CcPool;
  price: number | null;
  metrics: { ivRank?: number | null; earningsExpectedDate?: string | null; expirationIvxMap?: Record<string, number> | null };
  capacity: CoveredCallCapacity;
  basisOpts?: { allowBelowBasis?: boolean; basisSource?: 'typed' | 'broker' | null };
  /** The scan's rules (DTE and OI minimum); the view supplies delta and width. */
  baseRules: CcRulesType;
  isEtfOrIndex: boolean;
  classification?: 'index' | 'etf' | 'stock';
}

/** How many pooled calls the view's delta range or width hides (the "N hidden by result filters" count). */
export function countCcViewHidden(pool: CcPool, view: CcView, input: { dteMin: number; dteMax: number; stockPrice: number | null; costBasis: number | null; allowBelowBasis?: boolean; today?: Date }): number {
  const floor = ccStrikeFloor(input.stockPrice, input.costBasis, { allowBelowBasis: input.allowBelowBasis === true }).floor;
  if (floor === null) return 0;
  const params: CcEligibilityParams = {
    deltaTarget: { min: view.deltaMin, max: view.deltaMax },
    dteTarget: { min: input.dteMin, max: input.dteMax },
    minStrike: floor, oiMin: 0, widthPctMax: view.widthPctMax, widthCeiling: view.widthCeiling,
  };
  let hidden = 0;
  for (const expiration of Object.keys(pool.chains)) {
    const dte = daysUntil(expiration, input.today);
    for (const leg of pool.chains[expiration]) {
      const why = ccLegRejection(leg, dte, params);
      if (why === 'DELTA_WINDOW' || why === 'WIDTH') hidden += 1;
    }
  }
  return hidden;
}

export interface CcHiddenCall {
  expiration: string;
  dte: number;
  strike: number;
  delta: number;
  bid: number;
  ask: number;
  /** Bid/ask width as a percent of mid. */
  widthPct: number;
  /** Why the active view hides it. A call the delta range hides is never also listed for width. */
  reason: 'delta-low' | 'delta-high' | 'width';
}

/**
 * The calls the active view hides, for the "show me what's outside the view" list. Information only: never a pick and
 * never orderable. Strikes below the cost-basis floor and calls with no real market are not listed (they were never
 * candidates under any view); the strike grid's "Show below cost basis" covers the floor. Nearest to the view first.
 */
export function listCcViewHidden(pool: CcPool, view: CcView, input: { dteMin: number; dteMax: number; stockPrice: number | null; costBasis: number | null; allowBelowBasis?: boolean; today?: Date }): CcHiddenCall[] {
  const floor = ccStrikeFloor(input.stockPrice, input.costBasis, { allowBelowBasis: input.allowBelowBasis === true }).floor;
  if (floor === null) return [];
  const params: CcEligibilityParams = {
    deltaTarget: { min: view.deltaMin, max: view.deltaMax },
    dteTarget: { min: input.dteMin, max: input.dteMax },
    minStrike: floor, oiMin: 0, widthPctMax: view.widthPctMax, widthCeiling: view.widthCeiling,
  };
  const out: CcHiddenCall[] = [];
  for (const expiration of Object.keys(pool.chains)) {
    const dte = daysUntil(expiration, input.today);
    for (const leg of pool.chains[expiration]) {
      const why = ccLegRejection(leg, dte, params);
      if (why !== 'DELTA_WINDOW' && why !== 'WIDTH') continue;
      const mid = (leg.bid + leg.ask) / 2;
      const absDelta = Math.abs(leg.delta as number);
      out.push({
        expiration, dte, strike: leg.strikePrice, delta: absDelta, bid: leg.bid, ask: leg.ask,
        widthPct: mid > 0 ? ((leg.ask - leg.bid) / mid) * 100 : 0,
        reason: why === 'WIDTH' ? 'width' : absDelta < view.deltaMin ? 'delta-low' : 'delta-high',
      });
    }
  }
  const center = (view.deltaMin + view.deltaMax) / 2;
  return out.sort((a, b) => Math.abs(a.delta - center) - Math.abs(b.delta - center) || a.dte - b.dte || a.strike - b.strike);
}

function daysUntil(dateStr: string, today: Date = new Date()): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}
