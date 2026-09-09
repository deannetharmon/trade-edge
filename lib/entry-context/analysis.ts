export type CreditSpreadDirection = 'BPS' | 'BCS';

export interface CreditSpreadEntryFacts {
  otmBufferPct: number | null;
  expectedMoveClearancePct: number | null;
  expectedMoveState: 'UNAVAILABLE' | 'INSIDE' | 'OUTSIDE';
}

export function buildCreditSpreadEntryFacts(input: {
  strategy: CreditSpreadDirection;
  underlyingPrice: number | null;
  shortStrike: number;
  expectedMove: number | null;
}): CreditSpreadEntryFacts {
  const { strategy, underlyingPrice: price, shortStrike, expectedMove } = input;
  if (price == null || !Number.isFinite(price) || price <= 0 || !Number.isFinite(shortStrike)) {
    return { otmBufferPct: null, expectedMoveClearancePct: null, expectedMoveState: 'UNAVAILABLE' };
  }
  const otmBufferPct = strategy === 'BPS'
    ? (price - shortStrike) / price * 100
    : (shortStrike - price) / price * 100;
  if (expectedMove == null || !Number.isFinite(expectedMove) || expectedMove <= 0) {
    return { otmBufferPct, expectedMoveClearancePct: null, expectedMoveState: 'UNAVAILABLE' };
  }
  const boundary = strategy === 'BPS' ? price - expectedMove : price + expectedMove;
  const expectedMoveClearancePct = strategy === 'BPS'
    ? (boundary - shortStrike) / price * 100
    : (shortStrike - boundary) / price * 100;
  return { otmBufferPct, expectedMoveClearancePct, expectedMoveState: expectedMoveClearancePct < 0 ? 'INSIDE' : 'OUTSIDE' };
}
