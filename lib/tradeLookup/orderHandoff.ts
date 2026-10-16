// lib/tradeLookup/orderHandoff.ts

// TRADE-LOOKUP-0001D: turns one chosen lookup row into the object the existing CSP order dialog (CspTradeModal in
// app/screener/page.tsx) already takes, so the lookup adds NO order logic of its own. The dialog re-checks the live
// quote, collateral and market hours itself before anything can be placed.
//
// Only a short put with a real quote can be handed off. Covered calls have no order dialog in TradeEdge yet
// (the Covered Call scan says "Analysis only"), so they are inspection-only here too. No qualification verdict is
// attached: the lookup shows contracts the scans never qualified, and the dialog treats a missing verdict as
// "nothing to acknowledge" (the lookup's own flags are advisory).

import type { CheckResult, ScreenResult, SpreadCandidate } from '@/lib/scans/types';
import type { CcOrderInput } from '@/features/screener/components/CcTradeModal';
import type { LookupResult, LookupRow } from './lookupTypes';

const pending = (): CheckResult => ({ status: 'pending', value: '—', reason: 'Not evaluated: opened from Trade Lookup.' });

export type HandoffBlock = 'not_csp' | 'no_quote' | 'no_symbol' | 'wrong_row';

export function handoffBlockReason(result: LookupResult, row: LookupRow): HandoffBlock | null {
  if (result.contract.strategy !== 'CSP' || row.right !== 'P') return 'not_csp';
  if (result.rows.indexOf(row) === -1) return 'wrong_row';
  if (row.noQuote || row.mid === null || row.mid <= 0 || row.bid === null || row.ask === null) return 'no_quote';
  if (!row.occSymbol) return 'no_symbol';
  return null;
}

/** The ScreenResult the CSP order dialog expects, or null when this row cannot be ordered. */
export function buildCspOrderResult(result: LookupResult, row: LookupRow): ScreenResult | null {
  if (handoffBlockReason(result, row) !== null) return null;
  const mid = row.mid as number;
  const contracts = result.contracts;
  const requiredCash = row.strike * 100 * contracts;
  const totalPremium = parseFloat((mid * 100 * contracts).toFixed(2));
  const candidate: SpreadCandidate = {
    strategy: 'CSP',
    expiration: row.expiration,
    dte: row.dte,
    shortStrike: row.strike,
    longStrike: row.strike,
    shortDelta: row.delta === null ? 0 : Math.abs(row.delta),
    credit: totalPremium,
    spreadWidth: 0,
    creditRatio: requiredCash > 0 ? totalPremium / requiredCash : 0,
    roc: requiredCash > 0 ? (totalPremium / requiredCash) * 100 : 0,
    pop: row.pop,
    shortOI: row.openInterest === null ? 0 : row.openInterest,
    longOI: row.openInterest === null ? 0 : row.openInterest,
    shortOccSymbol: row.occSymbol,
    shortBid: row.bid as number,
    shortAsk: row.ask as number,
    cspMid: mid,
    requiredCash,
    capitalRequired: Math.max(0, requiredCash - totalPremium),
    contractMultiplier: 100,
    breakeven: row.breakeven === null ? undefined : row.breakeven,
    assignmentPrice: row.strike,
    quantity: contracts,
  };
  return {
    symbol: result.contract.ticker,
    strategy: 'CSP',
    price: result.underlyingPrice,
    ivr: null,
    qualified: false,
    bestCandidate: candidate,
    failReasons: [],
    underlyingType: result.classification === null ? undefined : result.classification,
    isEtf: result.classification === 'etf',
    checks: {
      ivr: pending(), earnings: pending(), oi: pending(), delta: pending(), credit: pending(),
      roc: pending(), pop: pending(), iv: pending(), emClearance: pending(),
    },
  };
}

export type CcHandoffBlock = 'not_cc' | 'not_covered' | 'no_quote' | 'no_symbol' | 'wrong_row';

/**
 * CC-ORDERS-0001C: a covered call can go to the call order dialog only when the lookup-time coverage check passed
 * and the row has a real quote. This is a convenience gate only: the dialog proves coverage again from a fresh broker
 * read at open, before the dry run, and inside the submit gate.
 */
export function ccHandoffBlockReason(result: LookupResult, row: LookupRow): CcHandoffBlock | null {
  if (result.contract.strategy !== 'CC' || row.right !== 'C') return 'not_cc';
  if (result.rows.indexOf(row) === -1) return 'wrong_row';
  if (!result.coverage.canOrder) return 'not_covered';
  if (row.noQuote || row.mid === null || row.mid <= 0 || row.bid === null || row.ask === null) return 'no_quote';
  if (!row.occSymbol) return 'no_symbol';
  return null;
}

/** What the covered-call order dialog takes, or null when this row cannot be ordered. */
export function buildCcOrderInput(result: LookupResult, row: LookupRow): CcOrderInput | null {
  if (ccHandoffBlockReason(result, row) !== null) return null;
  return {
    symbol: result.contract.ticker,
    occSymbol: row.occSymbol,
    strike: row.strike,
    expiration: row.expiration,
    dte: row.dte,
    delta: row.delta === null ? null : Math.abs(row.delta),
    midPerShare: parseFloat((row.mid as number).toFixed(2)),
    isIndex: result.classification === 'index',
    initialQuantity: result.contracts,
  };
}
