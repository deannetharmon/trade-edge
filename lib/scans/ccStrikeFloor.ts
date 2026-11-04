// lib/scans/ccStrikeFloor.ts
// CC-WHEEL-0001 S1 -- the one covered-call strike floor.
//
// A covered call may never be offered at a strike below max(stock price, cost
// basis). The floor needs BOTH numbers. When either is missing the floor is
// unknown and the caller must return no candidates (fail closed); it must never
// fall back to the one number it has, because that would offer a strike that
// locks in a loss against a basis nobody checked.

export type CcStrikeFloorMissing = 'NO_COST_BASIS' | 'NO_STOCK_PRICE';

export type CcStrikeFloor =
  | { floor: number; missing: null }
  | { floor: null; missing: CcStrikeFloorMissing };

function isPositive(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

export function ccStrikeFloor(
  stockPrice: number | null | undefined,
  costBasis: number | null | undefined,
): CcStrikeFloor {
  if (!isPositive(stockPrice)) return { floor: null, missing: 'NO_STOCK_PRICE' };
  if (!isPositive(costBasis)) return { floor: null, missing: 'NO_COST_BASIS' };
  return { floor: Math.max(stockPrice, costBasis), missing: null };
}

export function ccStrikeFloorMessage(missing: CcStrikeFloorMissing): string {
  return missing === 'NO_COST_BASIS'
    ? 'Cost basis unavailable or incomplete — no covered call is offered until a cost basis is known'
    : 'Stock price unavailable — no covered call is offered without a current price';
}
