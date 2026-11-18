// lib/trademap/graphModel.ts
//
// OPTMAP-0001 S2b: curve points for the Trade Map graph. Same pricing as the
// grid (positionAt), sampled across the price range for one date. The graph
// draws the selected date and the expiration-day curve together. Null when
// any point cannot be priced (fail closed, never a partial curve).

import { positionAt, type GridCell, type PricingParams } from './gridModel';
import type { TradeLeg } from './strategyLegs';

export interface CurvePoint {
  price: number;
  cell: GridCell;
}

/** Evenly spaced prices from spot*(1-rangePct) to spot*(1+rangePct), ascending. */
export function buildCurve(
  legs: TradeLeg[],
  spot: number,
  rangePct: number,
  dateIso: string,
  params: PricingParams,
  points = 81,
): CurvePoint[] | null {
  if (!(spot > 0) || !(rangePct > 0 && rangePct < 1) || !Number.isInteger(points) || points < 2) return null;
  const lo = spot * (1 - rangePct);
  const hi = spot * (1 + rangePct);
  const out: CurvePoint[] = [];
  for (let i = 0; i < points; i += 1) {
    const price = lo + ((hi - lo) * i) / (points - 1);
    const cell = positionAt(legs, price, dateIso, params);
    if (cell == null) return null;
    out.push({ price, cell });
  }
  return out;
}
