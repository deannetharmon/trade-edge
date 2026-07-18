// lib/paper-trading/pricing.ts
//
// PT-0001: quote validation and marketable fill simulation.
//
// Direction convention (section 7.2), matching the existing convention
// already established in app/portfolio/page.tsx's closeValue calculation
// (see its comment: "Buy to Close (short leg) fills at ask; Sell to Close
// (long leg) fills at bid"):
//   - Opening a short leg (sell_to_open)  -> bid  (you receive the bid)
//   - Opening a long leg  (buy_to_open)   -> ask  (you pay the ask)
//   - Closing a short leg (buy_to_close)  -> ask  (you pay the ask to buy back)
//   - Closing a long leg  (sell_to_close) -> bid  (you receive the bid)
//
// Net position value = sum over legs of the signed, multiplier-adjusted leg
// value, where "opening a short" and "closing a long" are money IN (+) and
// "opening a long" and "closing a short" are money OUT (-) ... expressed the
// other way for the CLOSE side, since closing a short costs money (+, a
// debit) and closing a long returns money (-, reducing the debit). See
// computeNetValue()'s inline signs — they are the direct algebraic mirror of
// the entry signs, applied to the close-side action instead of the open-side
// action.
//
// No market-hours utility exists anywhere in this repo today (confirmed
// during PT-0001 discovery), so the stale-quote policy defined here (section
// 7.4) is judged purely by quote age against STALE_QUOTE_THRESHOLD_SECONDS.
// This also transparently covers "market closed" — a quote fetched while the
// market was closed is, by definition, older than any threshold short enough
// to be meaningful during live trading hours.

import { PaperTradingError } from './types';
import type {
  PaperFillEvidence,
  PaperFillPricingSource,
  PaperLeg,
  PaperLegCloseAction,
  PaperLegQuote,
  PaperManualFillOverride,
  PaperQuoteSnapshot,
} from './types';

export const STALE_QUOTE_THRESHOLD_SECONDS = 300;

export function resolveClosingAction(openAction: PaperLeg['openAction']): PaperLegCloseAction {
  return openAction === 'buy_to_open' ? 'sell_to_close' : 'buy_to_close';
}

function fail(message: string, details?: Record<string, unknown>): never {
  throw new PaperTradingError('INVALID_QUOTE', message, details);
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function findLegQuote(legId: string, snapshot: PaperQuoteSnapshot): PaperLegQuote {
  const quote = snapshot.legs.find((q) => q.legId === legId);
  if (!quote) fail(`Missing quote evidence for leg ${legId}.`, { legId });
  return quote;
}

/**
 * Validates a quote snapshot against a specific set of legs for a specific
 * side (open or close). Throws PaperTradingError('INVALID_QUOTE', ...) on
 * any structural problem (section 7.3). Never silently substitutes mid.
 */
export function validateQuoteSnapshot(legs: PaperLeg[], snapshot: PaperQuoteSnapshot, side: 'open' | 'close'): void {
  for (const leg of legs) {
    const quote = findLegQuote(leg.legId, snapshot);

    if (quote.quoteTimestamp == null || Number.isNaN(new Date(quote.quoteTimestamp).getTime())) {
      fail(`Leg ${leg.legId} has a missing or unparsable quote timestamp.`, { legId: leg.legId });
    }

    const action = side === 'open' ? leg.openAction : resolveClosingAction(leg.openAction);
    const neededSide: 'bid' | 'ask' = action === 'sell_to_open' || action === 'sell_to_close' ? 'bid' : 'ask';
    const neededPrice = neededSide === 'bid' ? quote.bid : quote.ask;

    if (!isFiniteNumber(neededPrice)) {
      fail(`Leg ${leg.legId} is missing a valid ${neededSide} required for this action.`, { legId: leg.legId, side: neededSide });
    }
    if ((neededPrice as number) <= 0) {
      fail(`Leg ${leg.legId} has a non-positive ${neededSide}.`, { legId: leg.legId, price: neededPrice });
    }

    if (quote.bid != null && quote.ask != null) {
      if (!isFiniteNumber(quote.bid) || !isFiniteNumber(quote.ask)) {
        fail(`Leg ${leg.legId} has a non-finite bid or ask.`, { legId: leg.legId });
      }
      if (quote.bid > quote.ask) {
        fail(`Leg ${leg.legId} has a crossed quote (bid > ask).`, { legId: leg.legId, bid: quote.bid, ask: quote.ask });
      }
    }
  }
}

function computeNetValue(
  legs: PaperLeg[],
  snapshot: PaperQuoteSnapshot,
  side: 'open' | 'close',
  priceField: 'bid' | 'ask' | 'mid_directional',
  quantity: number,
  contractMultiplier: number,
): number | null {
  let total = 0;
  for (const leg of legs) {
    const quote = findLegQuote(leg.legId, snapshot);
    const action = side === 'open' ? leg.openAction : resolveClosingAction(leg.openAction);
    const isMoneyIn = action === 'sell_to_open' || action === 'sell_to_close'; // receiving money = bid side
    const neededSide: 'bid' | 'ask' = isMoneyIn ? 'bid' : 'ask';

    let price: number | null;
    if (priceField === 'mid_directional') {
      price = quote.mid ?? (quote.bid != null && quote.ask != null ? (quote.bid + quote.ask) / 2 : null);
    } else {
      price = neededSide === 'bid' ? quote.bid : quote.ask;
    }
    if (price == null) return null;

    // Raw cash flow from the trader's perspective for this leg: receiving
    // money (opening a short, or closing a long) is +, paying money
    // (opening a long, or closing a short) is -.
    const sign = isMoneyIn ? 1 : -1;
    total += sign * price * quantity * contractMultiplier;
  }

  // OPEN's result is meant to be read as entryCredit (positive = net credit
  // RECEIVED) -- the raw cash-flow sign already matches that directly.
  // CLOSE's result is meant to be read as a closing DEBIT (positive = net
  // amount PAID to close, matching ledger.ts's `cash -= closingDebit` and
  // `realizedPnl = entryCredit - closingDebit`) -- which is the negation of
  // the raw cash flow (a normal credit-strategy close is a net cash
  // OUTFLOW, i.e. raw cash flow is negative, and the debit is positive).
  return side === 'open' ? total : -total;
}

export interface FillComputationResult {
  netValue: number; // signed: for OPEN this is entryCredit (can be negative for a debit fill); for CLOSE this is the closing debit (can be negative)
  midNetValue: number | null;
  slippage: number | null;
}

export function computeMarketableFill(
  legs: PaperLeg[],
  snapshot: PaperQuoteSnapshot,
  side: 'open' | 'close',
  quantity: number,
  contractMultiplier: number,
): FillComputationResult {
  validateQuoteSnapshot(legs, snapshot, side);
  const netValue = computeNetValue(legs, snapshot, side, side === 'open' ? 'bid' : 'bid', quantity, contractMultiplier)!;
  const midNetValue = computeNetValue(legs, snapshot, side, 'mid_directional', quantity, contractMultiplier);
  const slippage = midNetValue != null ? Math.abs(midNetValue - netValue) : null;
  return { netValue, midNetValue, slippage };
}

export function oldestQuoteAgeSeconds(snapshot: PaperQuoteSnapshot, now: Date): number | null {
  const timestamps = snapshot.legs
    .map((l) => (l.quoteTimestamp ? new Date(l.quoteTimestamp).getTime() : null))
    .filter((t): t is number => t != null && !Number.isNaN(t));
  if (timestamps.length === 0) return null;
  const oldest = Math.min(...timestamps);
  return Math.max(0, Math.round((now.getTime() - oldest) / 1000));
}

export function isStale(ageSeconds: number | null): boolean {
  return ageSeconds != null && ageSeconds > STALE_QUOTE_THRESHOLD_SECONDS;
}

export interface BuildFillEvidenceArgs {
  legs: PaperLeg[];
  quantity: number;
  contractMultiplier: number;
  quoteSnapshot: PaperQuoteSnapshot | null;
  side: 'open' | 'close';
  staleConfirmed: boolean;
  manualOverride: PaperManualFillOverride | null;
  now?: Date;
}

/**
 * Central fill-evidence builder used by both entry and close. Enforces:
 *  - a quote snapshot is required unless a manual override is supplied
 *  - a stale quote requires explicit confirmation (never silently accepted)
 *  - a manual override is never labeled marketable and never used as an
 *    automatic fallback (it must be the caller's explicit, confirmed choice)
 */
export function buildFillEvidence(args: BuildFillEvidenceArgs): PaperFillEvidence {
  const { legs, quantity, contractMultiplier, quoteSnapshot, side, staleConfirmed, manualOverride, now = new Date() } = args;

  if (manualOverride) {
    if (!manualOverride.confirmedAt || !manualOverride.confirmedByUser) {
      throw new PaperTradingError('MANUAL_OVERRIDE_CONFIRMATION_REQUIRED', 'Manual paper fill requires explicit confirmation.');
    }
    if (!isFiniteNumber(manualOverride.manualPrice)) {
      throw new PaperTradingError('VALIDATION_ERROR', 'Manual paper fill price must be a finite number.');
    }

    // Mid/quote snapshot is preserved separately for analytics when available,
    // but never used to compute the applied fill value.
    let midValue: number | null = null;
    if (quoteSnapshot) {
      midValue = computeNetValue(legs, quoteSnapshot, side, 'mid_directional', quantity, contractMultiplier);
    }

    return {
      pricingSource: 'manual_paper_fill',
      midValue,
      marketableValue: null,
      simulatedFillValue: manualOverride.manualPrice,
      slippage: null,
      quoteAgeSeconds: quoteSnapshot ? oldestQuoteAgeSeconds(quoteSnapshot, now) : null,
      staleQuoteConfirmed: false,
      manualOverride,
      quoteSnapshot,
      evaluatedAt: now.toISOString(),
    };
  }

  if (!quoteSnapshot) {
    throw new PaperTradingError('INVALID_QUOTE', 'A quote snapshot is required unless a manual paper fill override is supplied.');
  }

  const ageSeconds = oldestQuoteAgeSeconds(quoteSnapshot, now);
  const stale = isStale(ageSeconds);
  if (stale && !staleConfirmed) {
    throw new PaperTradingError('STALE_QUOTE_CONFIRMATION_REQUIRED', 'This quote is stale and requires explicit confirmation before use.', {
      ageSeconds,
    });
  }

  const { netValue, midNetValue, slippage } = computeMarketableFill(legs, quoteSnapshot, side, quantity, contractMultiplier);

  const pricingSource: PaperFillPricingSource = stale ? 'stale_confirmed' : 'marketable';

  return {
    pricingSource,
    midValue: midNetValue,
    marketableValue: netValue,
    simulatedFillValue: netValue,
    slippage,
    quoteAgeSeconds: ageSeconds,
    staleQuoteConfirmed: stale && staleConfirmed,
    manualOverride: null,
    quoteSnapshot,
    evaluatedAt: now.toISOString(),
  };
}
