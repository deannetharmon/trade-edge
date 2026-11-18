// lib/trademap/stripModel.ts
//
// OPTMAP-0001 S2i (Ian and Diane, 2026-11-17): the strike strip. The legs of the chosen strategy are markers on a row of
// the listed strikes; dragging or clicking moves a leg. This file is the pure model: which strikes are shown, which
// markers can move, and what a move means (a new anchor strike or width). It never invents a strike: every result is
// a listed strike that legSpecs accepts, otherwise the move is refused. No I/O, no UI.

import type { ChainExpiration } from './chain';
import type { OptionRight } from './pricing';
import { legSpecs, nearestIndex, type LegSpec, type StrategyId } from './strategies';

export const MAX_WIDTH_STEPS = 50;
/** Open interest under this is drawn dimmed and called thin. */
export const THIN_OI = 200;

export type MarkerRole = 'anchor' | 'width' | 'mirror';
export interface StripMarker {
  strike: number;
  right: OptionRight;
  side: 'long' | 'short';
  /** anchor and width can be moved; mirror (the iron condor's call side) follows the anchor. */
  role: MarkerRole;
}

/** Strikes inside the chart range around the stock, widened so every marker is visible. */
export function stripWindow(strikes: number[], spot: number, rangePct: number, include: number[]): number[] {
  let lo = spot * (1 - rangePct);
  let hi = spot * (1 + rangePct);
  for (const k of include) { lo = Math.min(lo, k); hi = Math.max(hi, k); }
  return strikes.filter(k => k >= lo - 1e-9 && k <= hi + 1e-9);
}

/** Label every Nth strike so a dense chain stays readable. */
export function labelEvery(count: number): number {
  if (count <= 26) return 1;
  if (count <= 52) return 2;
  if (count <= 130) return 5;
  return 10;
}

/** Which side of the chain's quotes the strip needs for this strategy. */
export function rightsFor(strategy: StrategyId): OptionRight[] {
  if (strategy === 'long-call' || strategy === 'bcs') return ['C'];
  if (strategy === 'ic') return ['P', 'C'];
  return ['P'];
}

/** The right shown as a bar at a strike (an iron condor uses puts below the stock and calls above). */
export function barRight(strategy: StrategyId, strike: number, spot: number): OptionRight {
  const rights = rightsFor(strategy);
  if (rights.length === 1) return rights[0];
  return strike < spot ? 'P' : 'C';
}

export function markersFor(strategy: StrategyId, specs: LegSpec[]): StripMarker[] {
  const out: StripMarker[] = [];
  specs.forEach((s, i) => {
    let role: MarkerRole = 'mirror';
    if (strategy === 'ic') role = i === 0 ? 'anchor' : i === 1 ? 'width' : 'mirror';
    else role = s.side === 'short' || specs.length === 1 ? 'anchor' : 'width';
    out.push({ strike: s.strike, right: s.right, side: s.side, role });
  });
  return out;
}

/** The movable marker nearest a clicked strike (the anchor wins a tie). */
export function nearestMover(markers: StripMarker[], strike: number): StripMarker | null {
  let best: StripMarker | null = null;
  for (const m of markers) {
    if (m.role === 'mirror') continue;
    if (best == null) { best = m; continue; }
    const d = Math.abs(m.strike - strike);
    const bd = Math.abs(best.strike - strike);
    if (d < bd || (d === bd && m.role === 'anchor')) best = m;
  }
  return best;
}

export interface DragInput {
  strategy: StrategyId;
  chain: ChainExpiration;
  spot: number;
  anchor: number;
  widthSteps: number;
  role: 'anchor' | 'width' | 'slide';
  targetStrike: number;
}
export interface DragResult { anchor: number; widthSteps: number }

/** The anchor and width after moving a marker (on spreads the other leg stays put) to the listed strike nearest the target; null when that is not allowed. */
export function dragLeg(i: DragInput): DragResult | null {
  const strikes = i.chain.strikes.map(s => s.strike);
  if (strikes.length === 0 || !Number.isFinite(i.targetStrike)) return null;
  const snapped = strikes[nearestIndex(strikes, i.targetStrike)];
  let anchor = i.anchor;
  let widthSteps = i.widthSteps;
  if (i.role === 'anchor') {
    anchor = snapped;
    // On a spread, each marker moves on its own: moving the short leg leaves the long leg where it is, so the spread
    // widens or narrows (a single leg has no width to keep). The short leg stops one strike short of the long leg.
    if (i.strategy === 'bps' || i.strategy === 'bcs' || i.strategy === 'ic') {
      const a = strikes.indexOf(i.anchor);
      const t = strikes.indexOf(snapped);
      if (a < 0 || t < 0) return null;
      const longIdx = i.strategy === 'bcs' ? a + i.widthSteps : a - i.widthSteps;
      const steps = i.strategy === 'bcs' ? longIdx - t : t - longIdx;
      widthSteps = Math.min(MAX_WIDTH_STEPS, Math.max(1, steps));
      const keepIdx = i.strategy === 'bcs' ? longIdx - widthSteps : longIdx + widthSteps;
      if (keepIdx < 0 || keepIdx >= strikes.length) return null;
      anchor = strikes[keepIdx];
    }
  } else if (i.role === 'slide') {
    // The whole spread moves; the width is kept. targetStrike is where the short leg should land.
    anchor = snapped;
  } else {
    const a = strikes.indexOf(i.anchor);
    const t = strikes.indexOf(snapped);
    if (a < 0 || t < 0) return null;
    const steps = i.strategy === 'bcs' ? t - a : a - t;
    widthSteps = Math.min(MAX_WIDTH_STEPS, Math.max(1, steps));
  }
  if (legSpecs(i.strategy, i.chain, anchor, i.spot, widthSteps) == null) return null;
  return { anchor, widthSteps };
}

/** One step left or right along the listed strikes (keyboard). */
export function stepStrike(strikes: number[], from: number, dir: -1 | 1): number {
  const i = strikes.indexOf(from);
  if (i < 0) return from;
  return strikes[Math.min(strikes.length - 1, Math.max(0, i + dir))];
}

/** Strike under a pixel position on the strip. */
export function strikeAtX(strikes: number[], x: number, pxPerStrike: number): number | null {
  if (strikes.length === 0 || !(pxPerStrike > 0)) return null;
  const i = Math.min(strikes.length - 1, Math.max(0, Math.floor(x / pxPerStrike)));
  return strikes[i];
}

/** Width of a spread side in dollars, as a short label ("$10 wide"). */
export function widthLabel(a: number, b: number): string {
  const w = Math.round(Math.abs(a - b) * 100) / 100;
  return `$${Number.isInteger(w) ? w : w.toFixed(2).replace(/0$/, '')} wide`;
}
