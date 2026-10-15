// features/portfolio/positions-workspace/model/breakeven.ts

import type { Position } from '@/lib/portfolio-data/types';
import { computeIcBreakevens, computeSingleLegBreakeven, popAboveBreakeven, popBelowBreakeven } from '@/lib/portfolio/positionMetrics';

export interface BreakevenViewModel {
  values: number[];
  unavailableReason: string | null;
  /** Which way the stock may move before the position loses at expiration: UP-safe (short put, long call) or DOWN-safe (short call, long put). */
  favorable?: 'UP' | 'DOWN' | null;
}

/**
 * Price Buffer: how far the stock can move AGAINST the position before the at-expiration breakeven. Positive = cushion,
 * negative = past breakeven. Direction-aware (Ian, 2026-10-06): a short call or long put loses as the stock RISES /
 * stays high, so its buffer is breakeven minus stock, not stock minus breakeven. Single breakeven only.
 */
export function priceBufferFor(vm: BreakevenViewModel, stockPrice: number | null | undefined): { dollars: number; pct: number | null } | null {
  if (vm.values.length !== 1 || !vm.favorable || stockPrice == null || !Number.isFinite(stockPrice)) return null;
  const dollars = vm.favorable === 'UP' ? stockPrice - vm.values[0] : vm.values[0] - stockPrice;
  return { dollars, pct: stockPrice > 0 ? (dollars / stockPrice) * 100 : null };
}

export function buildBreakevenViewModel(position: Position): BreakevenViewModel {
  if (position.structureAmbiguous) return { values: [], unavailableReason: 'Position structure is ambiguous' };
  if (position.strategy === 'PMCC') return { values: [], unavailableReason: 'PMCC has no single canonical breakeven' };
  if (position.strategy === 'CC') return { values: [], unavailableReason: 'Covered Call share cost basis is not present on the option position' };
  if (position.entryEconomicsComplete !== true || position.entryCredit == null || !Number.isFinite(position.entryCredit)) {
    return { values: [], unavailableReason: 'Opening credit or debit is unavailable' };
  }
  if (!Number.isFinite(position.quantity) || position.quantity <= 0) {
    return { values: [], unavailableReason: 'Canonical contract quantity is unavailable' };
  }

  const creditPerShare = position.entryCredit / (position.quantity * 100);
  const shortPut = position.legs.find(leg => leg.direction === 'Short' && leg.optionType === 'P');
  const shortCall = position.legs.find(leg => leg.direction === 'Short' && leg.optionType === 'C');
  if (position.entryPriceEffect === 'Credit' && shortPut && shortCall) {
    const result = computeIcBreakevens(shortPut.strikePrice, shortCall.strikePrice, creditPerShare);
    return result.lowerBreakeven != null && result.upperBreakeven != null
      ? { values: [result.lowerBreakeven, result.upperBreakeven], unavailableReason: null }
      : { values: [], unavailableReason: 'Iron Condor opening economics are incomplete' };
  }
  if (position.entryPriceEffect === 'Credit' && shortPut) {
    const value = computeSingleLegBreakeven(shortPut.strikePrice, creditPerShare, 'P');
    return value == null ? { values: [], unavailableReason: 'Put breakeven is unavailable' } : { values: [value], unavailableReason: null, favorable: 'UP' };
  }
  if (position.entryPriceEffect === 'Credit' && shortCall) {
    const value = computeSingleLegBreakeven(shortCall.strikePrice, creditPerShare, 'C');
    return value == null ? { values: [], unavailableReason: 'Call breakeven is unavailable' } : { values: [value], unavailableReason: null, favorable: 'DOWN' };
  }
  // A standalone long call's at-expiration breakeven is strike plus the
  // verified debit per share. This is distinct from current P/L and makes
  // the LEAPS call's Price Buffer intelligible in the table.
  const longCall = position.legs.find(leg => leg.direction === 'Long' && leg.optionType === 'C');
  if (position.entryPriceEffect === 'Debit' && position.legs.length === 1 && longCall) {
    return { values: [longCall.strikePrice + creditPerShare], unavailableReason: null, favorable: 'UP' };
  }
  // A standalone long put's at-expiration breakeven is strike minus the verified debit per share.
  const longPut = position.legs.find(leg => leg.direction === 'Long' && leg.optionType === 'P');
  if (position.entryPriceEffect === 'Debit' && position.legs.length === 1 && longPut) {
    return { values: [longPut.strikePrice - creditPerShare], unavailableReason: null, favorable: 'DOWN' };
  }
  return { values: [], unavailableReason: 'No canonical breakeven policy exists for this structure' };
}

/**
 * LONG-OUTLOOK-0001 (Ian / Diane): what a bought call or put needs, and how likely it is, for the Strike / BE and POP cells.
 *
 * - Price Buffer is a credit-spread idea (a cushion). For a bought option the same number is a distance still to travel,
 *   so it is presented as "Needs", not as a loss.
 * - The two probabilities use the SAME zero-drift lognormal engine already behind the credit-spread POP column
 *   (popAboveBreakeven / popBelowBreakeven, symbol IV, calendar DTE). They are terminal (at-expiration) probabilities,
 *   not touch probabilities, and no new probability math is added here.
 * - Display only. Position.pop / popVsStrike stay null for debit structures on purpose: they feed the management-intent
 *   and objective logic, which was written for credit POP.
 * - Standalone long call or put only. Debit spreads and every other structure return null.
 */
export interface LongOptionOutlook {
  /** Direction the stock must move to reach the at-expiration breakeven: UP for a long call, DOWN for a long put. */
  direction: 'UP' | 'DOWN';
  strike: number;
  breakeven: number;
  /** Positive = distance still to travel to breakeven, in dollars per share. Zero or negative = breakeven already passed. */
  gapDollars: number;
  /** gapDollars as a percentage of the stock price (same basis as Price Buffer). */
  gapPct: number | null;
  breakevenReached: boolean;
  /** 0 to 1: how far the stock has travelled from the strike toward the breakeven (clamped). */
  rangeProgress: number;
  /** % chance the stock finishes beyond the strike (in the money) at expiration, or null without IV / DTE. */
  popStrike: number | null;
  /** % chance the stock finishes beyond the breakeven (profit) at expiration, or null without IV / DTE. */
  popBreakeven: number | null;
}

export function buildLongOptionOutlook(position: Position, vm: BreakevenViewModel = buildBreakevenViewModel(position)): LongOptionOutlook | null {
  if (position.entryPriceEffect !== 'Debit' || position.legs.length !== 1) return null;
  const leg = position.legs[0];
  if (!leg || leg.direction !== 'Long' || !Number.isFinite(leg.strikePrice)) return null;
  if (vm.values.length !== 1 || !vm.favorable) return null;
  const stock = position.stockPrice;
  if (stock == null || !Number.isFinite(stock) || stock <= 0) return null;

  const direction = vm.favorable;
  const strike = leg.strikePrice;
  const breakeven = vm.values[0];
  const gapDollars = direction === 'UP' ? breakeven - stock : stock - breakeven;
  const span = breakeven - strike;
  const travelled = stock - strike;
  const rangeProgress = span === 0 || !Number.isFinite(span) ? (gapDollars <= 0 ? 1 : 0) : Math.max(0, Math.min(1, travelled / span));

  const iv = position.iv ?? Number.NaN;
  const dte = position.dte ?? Number.NaN;
  const beyond = (threshold: number) => (direction === 'UP' ? popAboveBreakeven(stock, threshold, dte, iv) : popBelowBreakeven(stock, threshold, dte, iv));

  return {
    direction,
    strike,
    breakeven,
    gapDollars,
    gapPct: (gapDollars / stock) * 100,
    breakevenReached: gapDollars <= 0,
    rangeProgress,
    popStrike: beyond(strike),
    popBreakeven: beyond(breakeven),
  };
}
