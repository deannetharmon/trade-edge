// lib/portfolio/legCostBasis.ts

export interface CostBasisLeg {
  direction: 'Short' | 'Long';
  quantity: number;
  avgOpenPrice: number | null | undefined;
}

export interface LegCostBasis {
  /** Dollars paid for long legs (avg open x qty x 100). */
  longPaid: number;
  /** Dollars collected on short legs (avg open x qty x 100). */
  shortCollected: number;
  /** longPaid - shortCollected. Positive = net debit (money invested); negative = net credit. */
  net: number;
}

const OPTION_MULTIPLIER = 100;

/**
 * Entry cost basis of an option position from its legs. Returns null when any
 * leg lacks an average open price -- a partial sum would understate the basis.
 */
export function computeLegCostBasis(legs: CostBasisLeg[]): LegCostBasis | null {
  if (legs.length === 0) return null;
  let longPaid = 0;
  let shortCollected = 0;
  for (const leg of legs) {
    const price = leg.avgOpenPrice;
    if (price == null || !Number.isFinite(price)) return null;
    const dollars = price * Math.abs(leg.quantity) * OPTION_MULTIPLIER;
    if (leg.direction === 'Long') longPaid += dollars;
    else shortCollected += dollars;
  }
  return { longPaid, shortCollected, net: longPaid - shortCollected };
}
