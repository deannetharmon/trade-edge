// lib/exit-walk/closeOrder.ts
//
// EXIT-WALK-0001B step 3a: the pure pieces the "Walk the price" panel needs around a position close. Unwired.
//   - buildExitCloseOrder: the closing order body for one walk price (same shape as buildCloseOrder in app/portfolio/page.tsx;
//     always a Day order, because a walk must never leave a resting GTC behind)
//   - checkExitWalkEligibility: the refuse-to-start rules (Ian/Paul): one clean position, no working order on its legs
//   - runExitWalkGate: the existing runLiveCloseOrderSafetyGate, run on a walk price and its live quote
// Prices are integer cents here and broker option-price POINTS (cents / 100) at the gate and in the payload.
// Follow-up: expectedClosePnl / closePriceEffectFor below mirror the private helpers in app/portfolio/page.tsx; fold both
// into one shared module in a later cleanup (the page file is not touched by this slice's lib work).

import type { PendingOrder, Position } from '@/lib/portfolio-data/types';
import {
  runLiveCloseOrderSafetyGate,
  type ActualBrokerOrderEvidence,
  type PriceEffect,
  type SafetyCheckResult,
} from '@/lib/portfolio/closeOrderSafety';
import type { CanonicalCloseIdentity } from '@/lib/portfolio/closeOrderSafety';
import type { ExitSide, Quote } from './types';

export interface ExitCloseOrderLeg {
  symbol: string;
  quantity: number;
  action: 'Buy to Close' | 'Sell to Close';
  'instrument-type': 'Equity Option' | 'Index Option';
}
export interface ExitCloseOrderBody {
  'order-type': 'Limit';
  'time-in-force': 'Day';
  price: string;
  'price-effect': PriceEffect;
  legs: ExitCloseOrderLeg[];
}

const INDEX_UNDERLYINGS = ['SPX', 'NDX', 'RUT', 'VIX'];
export const instrumentTypeFor = (underlying: string): 'Equity Option' | 'Index Option' =>
  INDEX_UNDERLYINGS.includes(underlying.toUpperCase().trim()) ? 'Index Option' : 'Equity Option';

/** Credit-opened positions close for a debit (buy); debit-opened positions close for a credit (sell). Unknown: no walk. */
export function exitSideFor(entryPriceEffect: 'Credit' | 'Debit' | 'Unknown'): ExitSide | null {
  if (entryPriceEffect === 'Credit') return 'buy';
  if (entryPriceEffect === 'Debit') return 'sell';
  return null;
}
export const closeEffectFor = (side: ExitSide): PriceEffect => (side === 'buy' ? 'Debit' : 'Credit');

export function buildExitCloseOrder(
  pos: Pick<Position, 'symbol' | 'legs'>,
  price_c: number,
  side: ExitSide,
): ExitCloseOrderBody {
  const itype = instrumentTypeFor(pos.symbol);
  return {
    'order-type': 'Limit',
    'time-in-force': 'Day',
    // The price is a positive magnitude; the direction is carried by price-effect. Floor at one cent.
    price: (Math.max(Math.abs(price_c), 1) / 100).toFixed(2),
    'price-effect': closeEffectFor(side),
    legs: pos.legs.map(leg => ({
      symbol: leg.symbol,
      quantity: leg.quantity,
      action: leg.direction === 'Short' ? 'Buy to Close' : 'Sell to Close',
      'instrument-type': itype,
    })),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Regular session (09:30 to 16:00 ET, weekdays). Holidays and early closes belong to the trading-day calendar (S2).
// ---------------------------------------------------------------------------------------------------------------------

const etFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
export function isRegularSession(nowMs: number): boolean {
  const parts = etFormatter.formatToParts(new Date(nowMs));
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  const weekday = get('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

// ---------------------------------------------------------------------------------------------------------------------
// Eligibility: refuse before any order exists
// ---------------------------------------------------------------------------------------------------------------------

export type ExitWalkIneligible =
  | 'structure_unclear'
  | 'entry_unknown'
  | 'working_order'
  | 'market_closed';

export type ExitWalkEligibility =
  | { ok: true; side: ExitSide; identity: CanonicalCloseIdentity }
  | { ok: false; reason: ExitWalkIneligible; message: string };

export function checkExitWalkEligibility(
  pos: Pick<Position, 'structureAmbiguous' | 'structureBlockMessage' | 'identity' | 'entryPriceEffect' | 'hasGtc' | 'legs' | 'accountNumber'>,
  pendingOrders: Array<Pick<PendingOrder, 'accountNumber' | 'legs'>>,
  nowMs: number,
): ExitWalkEligibility {
  if (pos.structureAmbiguous || !pos.identity) {
    return { ok: false, reason: 'structure_unclear', message: pos.structureBlockMessage ?? 'This position could not be read as one clear structure.' };
  }
  const side = exitSideFor(pos.entryPriceEffect);
  if (!side) return { ok: false, reason: 'entry_unknown', message: 'The entry price is unknown, so the walk cannot tell a credit close from a debit close.' };
  const legSymbols = new Set(pos.legs.map(l => l.symbol));
  const clash = pendingOrders.some(o => o.accountNumber === pos.accountNumber && o.legs.some(l => legSymbols.has(l.symbol)));
  if (pos.hasGtc || clash) {
    return { ok: false, reason: 'working_order', message: 'This position already has a working order. Cancel it first; the walk never cancels another order.' };
  }
  if (!isRegularSession(nowMs)) return { ok: false, reason: 'market_closed', message: 'The walk runs only during the regular session (9:30 AM to 4:00 PM ET).' };
  return { ok: true, side, identity: pos.identity };
}

// ---------------------------------------------------------------------------------------------------------------------
// Safety gate on a walk price
// ---------------------------------------------------------------------------------------------------------------------

/** Mirrors expectedClosePnl in app/portfolio/page.tsx: P&L in dollars if the whole position closes at this price. */
export function expectedClosePnlDollars(identity: CanonicalCloseIdentity, side: ExitSide, closePricePoints: number): number {
  const entryCashFlow = identity.entryPriceEffect === 'Credit' ? identity.entryPricePointsPerUnit : -identity.entryPricePointsPerUnit;
  const closeCashFlow = side === 'sell' ? Math.abs(closePricePoints) : -Math.abs(closePricePoints);
  return (entryCashFlow + closeCashFlow) * identity.quantity * identity.contractMultiplier;
}

export interface ExitWalkGateInput {
  pos: Pick<Position, 'symbol' | 'legs'>;
  identity: CanonicalCloseIdentity;
  side: ExitSide;
  price_c: number;
  /** The live quote in the walk's orientation (see exitQuoteFromLegs). */
  quote: Quote;
  nowMs: number;
}

export function runExitWalkGate(input: ExitWalkGateInput): SafetyCheckResult {
  const { pos, identity, side, price_c, quote, nowMs } = input;
  const body = buildExitCloseOrder(pos, price_c, side);
  const points = Number(body.price);
  const effect = closeEffectFor(side);
  const actualOrder: ActualBrokerOrderEvidence = {
    legs: body.legs.map(l => ({ symbol: l.symbol, quantity: l.quantity, direction: l.action === 'Buy to Close' ? 'Short' : 'Long' })),
    limitPricePointsPerUnit: points,
    priceEffect: effect,
    orderType: body['order-type'],
    timeInForce: body['time-in-force'],
  };
  const fetchedAtMs = Date.parse(quote.t);
  return runLiveCloseOrderSafetyGate({
    identity,
    requestedQuantity: identity.quantity,
    closeableQuantity: identity.quantity,
    pricingIntent: 'CUSTOM',
    requestedClosePriceEffect: effect,
    closePricePointsPerUnit: points,
    quote: {
      netBid: quote.bid_c / 100,
      netAsk: quote.ask_c / 100,
      netMid: (quote.bid_c + quote.ask_c) / 200,
      fetchedAtMs: Number.isFinite(fetchedAtMs) ? fetchedAtMs : null,
    },
    nowMs,
    actualOrder,
    displayedExpectedPnlDollars: expectedClosePnlDollars(identity, side, points),
  });
}

/** The walk's `checkPrice` hook: null when the gate passes, otherwise the gate's own messages. */
export function exitWalkGateRefusal(input: ExitWalkGateInput): string | null {
  const result = runExitWalkGate(input);
  if (result.ok) return null;
  return result.issues.map(i => `${i.ruleId}: ${i.message}`).join(' ');
}
