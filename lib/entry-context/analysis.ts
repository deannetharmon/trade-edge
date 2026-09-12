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


// TRADE-ENTRY-SNAPSHOT-0001 -- Iron Condor gets its own facts function
// rather than extending buildCreditSpreadEntryFacts's single-direction
// formula. An IC has two short strikes (put side, call side) forming a
// range, not a direction -- there is no single "shortStrike" to measure
// buffer/clearance against. Both sides are computed independently and the
// tighter (worse) side is reported, matching the existing convention in
// Targeted mode's own Min OTM % control ("gates on the tighter of
// put/call side").
export interface IronCondorEntryFacts {
  putOtmBufferPct: number | null;
  callOtmBufferPct: number | null;
  otmBufferPct: number | null; // tighter of the two sides
  putExpectedMoveClearancePct: number | null;
  callExpectedMoveClearancePct: number | null;
  expectedMoveClearancePct: number | null; // tighter of the two sides
  expectedMoveState: 'UNAVAILABLE' | 'INSIDE' | 'OUTSIDE';
}

export function buildIronCondorEntryFacts(input: {
  underlyingPrice: number | null;
  putShortStrike: number;
  callShortStrike: number;
  expectedMove: number | null;
}): IronCondorEntryFacts {
  const { underlyingPrice: price, putShortStrike, callShortStrike, expectedMove } = input;
  const unavailable: IronCondorEntryFacts = {
    putOtmBufferPct: null, callOtmBufferPct: null, otmBufferPct: null,
    putExpectedMoveClearancePct: null, callExpectedMoveClearancePct: null, expectedMoveClearancePct: null,
    expectedMoveState: 'UNAVAILABLE',
  };
  if (price == null || !Number.isFinite(price) || price <= 0 || !Number.isFinite(putShortStrike) || !Number.isFinite(callShortStrike)) {
    return unavailable;
  }
  // Put side: buffer is how far price sits above the put short strike.
  // Call side: buffer is how far price sits below the call short strike.
  const putOtmBufferPct = (price - putShortStrike) / price * 100;
  const callOtmBufferPct = (callShortStrike - price) / price * 100;
  const otmBufferPct = Math.min(putOtmBufferPct, callOtmBufferPct);
  if (expectedMove == null || !Number.isFinite(expectedMove) || expectedMove <= 0) {
    return { ...unavailable, putOtmBufferPct, callOtmBufferPct, otmBufferPct };
  }
  const putBoundary = price - expectedMove;
  const callBoundary = price + expectedMove;
  const putExpectedMoveClearancePct = (putBoundary - putShortStrike) / price * 100;
  const callExpectedMoveClearancePct = (callShortStrike - callBoundary) / price * 100;
  const expectedMoveClearancePct = Math.min(putExpectedMoveClearancePct, callExpectedMoveClearancePct);
  return {
    putOtmBufferPct, callOtmBufferPct, otmBufferPct,
    putExpectedMoveClearancePct, callExpectedMoveClearancePct, expectedMoveClearancePct,
    expectedMoveState: expectedMoveClearancePct < 0 ? 'INSIDE' : 'OUTSIDE',
  };
}
