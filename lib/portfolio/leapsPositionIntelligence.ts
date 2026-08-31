import type { Position } from '@/lib/portfolio-data/types';

export interface LeapsEconomics {
  originalCost: number | null;
  estimatedValueNowMid: number | null;
  estimatedSellNowValue: number | null;
  unrealizedPnlMid: number | null;
  profitIfClosedNow: number | null;
  returnIfClosedNowPct: number | null;
  intrinsicValueMid: number | null;
  extrinsicValueMid: number | null;
  moneynessPct: number | null;
  slippageVsMid: number | null;
  complete: boolean;
  reasons: string[];
}

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isStandaloneLeapsPosition(position: Pick<Position, 'structureAmbiguous' | 'legs' | 'dte'>): boolean {
  if (position.structureAmbiguous || position.legs.length !== 1) return false;
  const leg = position.legs[0];
  return leg.direction === 'Long' && leg.optionType === 'C' && leg.quantity > 0 && position.dte > 120;
}

export function computeDebitCloseNowReturnPct(input: {
  entryPriceEffect: Position['entryPriceEffect'];
  entryEconomicsComplete?: boolean;
  originalDebit: number | null | undefined;
  closeNowPnl: number | null | undefined;
}): number | null {
  if (input.entryPriceEffect !== 'Debit' || input.entryEconomicsComplete !== true) return null;
  if (!finite(input.originalDebit) || input.originalDebit <= 0 || !finite(input.closeNowPnl)) return null;
  return (input.closeNowPnl / input.originalDebit) * 100;
}

export function computeLongCallIntrinsicValue(input: {
  underlyingPrice: number | null | undefined;
  strikePrice: number | null | undefined;
  quantity: number | null | undefined;
  contractMultiplier?: number;
}): number | null {
  const multiplier = input.contractMultiplier ?? 100;
  if (!finite(input.underlyingPrice) || !finite(input.strikePrice) || !finite(input.quantity)) return null;
  if (input.quantity <= 0 || !finite(multiplier) || multiplier <= 0) return null;
  return Math.max(input.underlyingPrice - input.strikePrice, 0) * input.quantity * multiplier;
}

export function computeLongCallMoneynessPct(input: {
  underlyingPrice: number | null | undefined;
  strikePrice: number | null | undefined;
}): number | null {
  if (!finite(input.underlyingPrice) || input.underlyingPrice <= 0 || !finite(input.strikePrice)) return null;
  return ((input.underlyingPrice - input.strikePrice) / input.underlyingPrice) * 100;
}

export function buildLeapsEconomics(position: Position): LeapsEconomics | null {
  if (!isStandaloneLeapsPosition(position)) return null;
  const leg = position.legs[0];
  const reasons: string[] = [];
  const originalCost = position.entryPriceEffect === 'Debit' && position.entryEconomicsComplete === true && finite(position.entryCredit)
    ? position.entryCredit!
    : null;
  if (originalCost == null) reasons.push('Entry basis incomplete');

  const estimatedValueNowMid = finite(position.currentValue) ? position.currentValue : null;
  if (estimatedValueNowMid == null) reasons.push('Midpoint quote unavailable');

  const estimatedSellNowValue = finite(position.closeValue) ? position.closeValue : null;
  if (estimatedSellNowValue == null) reasons.push('Executable sell quote unavailable');

  const unrealizedPnlMid = position.entryEconomicsComplete === true && finite(position.pnl) ? position.pnl : null;
  const profitIfClosedNow = position.entryEconomicsComplete === true && finite(position.closeNowPnl) ? position.closeNowPnl : null;
  const returnIfClosedNowPct = computeDebitCloseNowReturnPct({
    entryPriceEffect: position.entryPriceEffect,
    entryEconomicsComplete: position.entryEconomicsComplete,
    originalDebit: originalCost,
    closeNowPnl: profitIfClosedNow,
  });

  const intrinsicValueMid = computeLongCallIntrinsicValue({
    underlyingPrice: position.stockPrice,
    strikePrice: leg.strikePrice,
    quantity: leg.quantity,
    contractMultiplier: position.identity?.contractMultiplier ?? 100,
  });
  const extrinsicValueMid = intrinsicValueMid != null && estimatedValueNowMid != null
    ? Math.max(estimatedValueNowMid - intrinsicValueMid, 0)
    : null;
  const moneynessPct = computeLongCallMoneynessPct({ underlyingPrice: position.stockPrice, strikePrice: leg.strikePrice });
  const slippageVsMid = estimatedValueNowMid != null && estimatedSellNowValue != null
    ? estimatedSellNowValue - estimatedValueNowMid
    : null;

  return {
    originalCost,
    estimatedValueNowMid,
    estimatedSellNowValue,
    unrealizedPnlMid,
    profitIfClosedNow,
    returnIfClosedNowPct,
    intrinsicValueMid,
    extrinsicValueMid,
    moneynessPct,
    slippageVsMid,
    complete: reasons.length === 0,
    reasons,
  };
}
