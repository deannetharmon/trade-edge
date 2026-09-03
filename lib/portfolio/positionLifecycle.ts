// lib/portfolio/positionLifecycle.ts

import { parseOccSymbol } from '@/lib/optionSymbol';

export type OptionType = 'P' | 'C';
export type LegDirection = 'Short' | 'Long';

export interface LifecycleLeg {
  symbol: string;
  optionType: OptionType;
  strikePrice: number;
  direction: LegDirection;
  quantity: number;
  avgOpenPrice?: number | null;
  currentPrice?: number | null;
}

export interface LifecycleStockPosition {
  symbol: string;
  quantity: number;
  averageOpenPrice?: number | null;
  currentPrice?: number | null;
}

export type PositionLifecycleType =
  | 'SPREAD'
  | 'CSP'
  | 'ASSIGNED_STOCK'
  | 'COVERED_CALL'
  | 'PMCC'
  | 'LEAPS'
  | 'UNKNOWN';

export interface LifecycleClassificationInput {
  symbol: string;
  legs?: LifecycleLeg[];
  stockPosition?: LifecycleStockPosition | null;
}

export interface LifecycleClassification {
  type: PositionLifecycleType;
  symbol: string;
  contracts: number;
  shares: number;
  shortPuts: LifecycleLeg[];
  longPuts: LifecycleLeg[];
  shortCalls: LifecycleLeg[];
  longCalls: LifecycleLeg[];
  reason: string;
}

function absQty(qty: number | null | undefined): number {
  return Math.abs(Number(qty ?? 0));
}

function totalContracts(legs: LifecycleLeg[]): number {
  if (!legs.length) return 0;
  return legs.reduce((max, leg) => Math.max(max, absQty(leg.quantity)), 0);
}

export function splitOptionLegs(legs: LifecycleLeg[] = []) {
  const shortPuts = legs.filter(
    leg => leg.optionType === 'P' && leg.direction === 'Short'
  );

  const longPuts = legs.filter(
    leg => leg.optionType === 'P' && leg.direction === 'Long'
  );

  const shortCalls = legs.filter(
    leg => leg.optionType === 'C' && leg.direction === 'Short'
  );

  const longCalls = legs.filter(
    leg => leg.optionType === 'C' && leg.direction === 'Long'
  );

  return { shortPuts, longPuts, shortCalls, longCalls };
}

export function isSpreadPosition(legs: LifecycleLeg[] = []): boolean {
  const { shortPuts, longPuts, shortCalls, longCalls } = splitOptionLegs(legs);

  const putSpread = shortPuts.length > 0 && longPuts.length > 0;
  const callSpread = shortCalls.length > 0 && longCalls.length > 0;

  return putSpread || callSpread;
}

// TE-0007D corrective — a PMCC (long-dated deep-ITM call + short-dated OTM
// call) is structurally a call spread by isSpreadPosition's definition
// above (one long call, one short call), so without this check every held
// PMCC was silently misclassified as a generic SPREAD. LifecycleLeg has no
// expiration field of its own; parseOccSymbol decodes it from the OCC
// symbol already present on `symbol` -- the same canonical parser the
// merged PMCC pairing engine uses, so this stays consistent with how a
// PMCC is defined everywhere else in the app.
//
// Threshold (short DTE < 60, long DTE > 120) mirrors the real PMCC shape
// already established for the screener/pairing engine (short call window
// 21-45 DTE default, long call window 180-730 DTE default) rather than an
// arbitrary day-gap -- a 45/120 DTE pair should classify as PMCC, a 21/45
// pair should not.
//
// Known limitation, not solved here: this checks expiration gap only, not
// moneyness. A same-underlying call spread where the "long" leg happens to
// sit 130+ DTE out but isn't actually deep ITM will still classify as
// PMCC even though it's really just a wide speculative call spread, not a
// LEAPS-anchored diagonal. LifecycleLeg carries strikePrice but no delta,
// so a moneyness-aware refinement isn't possible with today's data shape.
export const PMCC_SHORT_DTE_MAX = 60;
export const PMCC_LONG_DTE_MIN = 120;

// A standalone long call held with no paired short leg -- previously fell all the way through
// classifyPositionLifecycle to UNKNOWN, since isCoveredCall/isPmccPosition/isSpreadPosition all
// require a second leg of some kind. Reuses PMCC_LONG_DTE_MIN as the "long-dated" bar so a solo
// long call is held to the same DTE threshold PMCC's own long leg already uses -- a short-dated
// long call bought outright (e.g. 30 DTE) is not a LEAP and should NOT classify here; it falls
// through to SPREAD/UNKNOWN as before. Scoped to calls only, not puts -- in this app's context
// LEAPS specifically anchors a future PMCC (a long call held on its own, eligible to later have a
// short call sold against it), not a standalone long-dated put.
const LEAPS_DTE_MIN = PMCC_LONG_DTE_MIN;

function daysUntil(dateStr: string): number {
  const target = new Date(`${dateStr}T00:00:00Z`);
  const now = new Date();
  const utcNow = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target.getTime() - utcNow) / 86400000);
}

export function isPmccPosition(legs: LifecycleLeg[] = []): boolean {
  const { shortCalls, longCalls } = splitOptionLegs(legs);
  if (shortCalls.length === 0 || longCalls.length === 0) return false;

  return shortCalls.some(shortLeg => {
    const shortExpiry = parseOccSymbol(shortLeg.symbol).expiry;
    if (!shortExpiry) return false;
    const shortDte = daysUntil(shortExpiry);
    if (shortDte >= PMCC_SHORT_DTE_MAX) return false;

    return longCalls.some(longLeg => {
      const longExpiry = parseOccSymbol(longLeg.symbol).expiry;
      if (!longExpiry) return false;
      return daysUntil(longExpiry) > PMCC_LONG_DTE_MIN;
    });
  });
}


// A standalone long call, no short call paired against it, no puts of either kind, and
// long-dated (DTE > LEAPS_DTE_MIN). This is checked as its own case rather than left to fall
// through to SPREAD/UNKNOWN -- a solo long call held on its own (eligible foundation for a future
// PMCC, or simply a directional LEAP) is a distinct, meaningful position shape from an
// unclassifiable one.
export function isLeapsPosition(legs: LifecycleLeg[] = []): boolean {
  const { shortPuts, longPuts, shortCalls, longCalls } = splitOptionLegs(legs);

  if (longCalls.length === 0) return false;
  if (shortCalls.length > 0 || shortPuts.length > 0 || longPuts.length > 0) return false;

  return longCalls.every(leg => {
    const expiry = parseOccSymbol(leg.symbol).expiry;
    if (!expiry) return false;
    return daysUntil(expiry) > LEAPS_DTE_MIN;
  });
}

export function isCashSecuredPut(legs: LifecycleLeg[] = []): boolean {
  const { shortPuts, longPuts, shortCalls, longCalls } = splitOptionLegs(legs);

  return (
    shortPuts.length === 1 &&
    longPuts.length === 0 &&
    shortCalls.length === 0 &&
    longCalls.length === 0
  );
}

export function isAssignedStock(
  stockPosition: LifecycleStockPosition | null | undefined,
  legs: LifecycleLeg[] = []
): boolean {
  return Boolean(stockPosition && absQty(stockPosition.quantity) > 0 && legs.length === 0);
}

export function isCoveredCall(
  stockPosition: LifecycleStockPosition | null | undefined,
  legs: LifecycleLeg[] = []
): boolean {
  const { shortPuts, longPuts, shortCalls, longCalls } = splitOptionLegs(legs);
  const shares = absQty(stockPosition?.quantity);

  return (
    shares >= 100 &&
    shortCalls.length > 0 &&
    shortPuts.length === 0 &&
    longPuts.length === 0 &&
    longCalls.length === 0
  );
}

export function classifyPositionLifecycle(
  input: LifecycleClassificationInput
): LifecycleClassification {
  const legs = input.legs ?? [];
  const stockPosition = input.stockPosition ?? null;
  const shares = absQty(stockPosition?.quantity);

  const { shortPuts, longPuts, shortCalls, longCalls } = splitOptionLegs(legs);
  const contracts = totalContracts(legs);

  if (isCoveredCall(stockPosition, legs)) {
    return {
      type: 'COVERED_CALL',
      symbol: input.symbol,
      contracts,
      shares,
      shortPuts,
      longPuts,
      shortCalls,
      longCalls,
      reason: 'Stock shares plus one or more short calls.',
    };
  }

  if (isAssignedStock(stockPosition, legs)) {
    return {
      type: 'ASSIGNED_STOCK',
      symbol: input.symbol,
      contracts: 0,
      shares,
      shortPuts,
      longPuts,
      shortCalls,
      longCalls,
      reason: 'Stock shares with no option legs.',
    };
  }

  if (isCashSecuredPut(legs)) {
    return {
      type: 'CSP',
      symbol: input.symbol,
      contracts,
      shares,
      shortPuts,
      longPuts,
      shortCalls,
      longCalls,
      reason: 'Single short put with no long hedge.',
    };
  }

  if (isPmccPosition(legs)) {
    return {
      type: 'PMCC',
      symbol: input.symbol,
      contracts,
      shares,
      shortPuts,
      longPuts,
      shortCalls,
      longCalls,
      reason: 'Long-dated deep-ITM-window call paired with a short-dated call (short DTE < 60, long DTE > 120).',
    };
  }

  if (isLeapsPosition(legs)) {
    return {
      type: 'LEAPS',
      symbol: input.symbol,
      contracts,
      shares,
      shortPuts,
      longPuts,
      shortCalls,
      longCalls,
      reason: `Standalone long call with no paired short leg, DTE > ${LEAPS_DTE_MIN}.`,
    };
  }

  if (isSpreadPosition(legs)) {
    return {
      type: 'SPREAD',
      symbol: input.symbol,
      contracts,
      shares,
      shortPuts,
      longPuts,
      shortCalls,
      longCalls,
      reason: 'Defined-risk spread detected from long and short option legs.',
    };
  }

  return {
    type: 'UNKNOWN',
    symbol: input.symbol,
    contracts,
    shares,
    shortPuts,
    longPuts,
    shortCalls,
    longCalls,
    reason: 'No lifecycle classification matched.',
  };
}

// CSP math

export function calcCspEffectiveBuyPrice(
  strike: number,
  premiumPerShare: number
): number {
  return strike - premiumPerShare;
}

export function calcCspCashRequired(
  strike: number,
  contracts: number
): number {
  return strike * 100 * contracts;
}

export function calcCspOptionPnl(
  entryPremiumPerShare: number,
  currentOptionValuePerShare: number,
  contracts: number
): number {
  return (entryPremiumPerShare - currentOptionValuePerShare) * 100 * contracts;
}

// Stock / covered-call math

export function calcCoveredShares(
  sharesHeld: number,
  callContracts: number
): number {
  return Math.min(absQty(sharesHeld), absQty(callContracts) * 100);
}

export function calcUncoveredShares(
  sharesHeld: number,
  callContracts: number
): number {
  return Math.max(0, absQty(sharesHeld) - absQty(callContracts) * 100);
}

export function calcUnrealizedStockPnl(
  currentPrice: number,
  effectiveCostBasis: number,
  sharesHeld: number
): number {
  return (currentPrice - effectiveCostBasis) * sharesHeld;
}

export function calcCalledAwayProfit(
  callStrike: number,
  effectiveCostBasis: number,
  coveredShares: number,
  realizedPremiumPnl: number
): number {
  return (callStrike - effectiveCostBasis) * coveredShares + realizedPremiumPnl;
}
