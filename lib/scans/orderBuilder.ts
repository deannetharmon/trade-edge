// lib/scans/orderBuilder.ts
//
// PMCC-0007: buildOrderLegs, buildOrderPayload, and hasOccSymbolsForOrder
// extracted from app/screener/page.tsx into their own module. Two reasons:
//
// 1. Next.js forbids named exports other than the page component (plus a
//    small allow-list like `dynamic`) from a special page.tsx file -- the
//    exact bug that broke a Vercel build earlier this week
//    (AuditEntry/filterStopGtcHistory in app/portfolio/page.tsx). These
//    functions weren't exported before, but PMCC-0007's Definition of Done
//    requires direct unit tests for the new PMCC branches, so they need a
//    real module to live in rather than being exported from page.tsx.
// 2. Pure, self-contained logic -- no reason for it to live inside the
//    giant screener page file at all.
//
// app/screener/page.tsx imports from here now instead of defining these
// locally; behavior for BPS/BCS/IC is unchanged, verbatim.

import type { ScreenResult, SpreadCandidate } from './types';

export function hasOccSymbolsForOrder(c: SpreadCandidate): boolean {
  if (c.strategy === 'PMCC') {
    // PMCC-0007: PMCC candidates carry their own OCC symbol field pair
    // (longOccSymbolPMCC/shortOccSymbolPMCC), never the generic
    // shortOccSymbol/longOccSymbol fields BPS/BCS/IC use -- see
    // findBestPMCC. Gating on the generic fields (as the pre-PMCC-0007
    // check did) always evaluated false for PMCC, which is exactly why
    // order submission was unreachable for PMCC before this ticket.
    return Boolean(c.longOccSymbolPMCC && c.shortOccSymbolPMCC);
  }
  return Boolean(c.shortOccSymbol && c.longOccSymbol &&
    (c.strategy !== 'IC' || (c.shortCallOccSymbol && c.longCallOccSymbol)));
}

export function buildOrderLegs(result: ScreenResult, c: SpreadCandidate): any[] {
  const instrType = result.underlyingType === 'index' ? 'Index Option' : 'Equity Option';
  const legs: any[] = [];
  if (c.strategy === 'BPS') {
    legs.push({ 'instrument-type': instrType, symbol: c.shortOccSymbol!, quantity: 1, action: 'Sell to Open' });
    legs.push({ 'instrument-type': instrType, symbol: c.longOccSymbol!, quantity: 1, action: 'Buy to Open' });
  } else if (c.strategy === 'BCS') {
    legs.push({ 'instrument-type': instrType, symbol: c.shortOccSymbol!, quantity: 1, action: 'Sell to Open' });
    legs.push({ 'instrument-type': instrType, symbol: c.longOccSymbol!, quantity: 1, action: 'Buy to Open' });
  } else if (c.strategy === 'IC') {
    legs.push({ 'instrument-type': instrType, symbol: c.shortOccSymbol!, quantity: 1, action: 'Sell to Open' });
    legs.push({ 'instrument-type': instrType, symbol: c.longOccSymbol!, quantity: 1, action: 'Buy to Open' });
    legs.push({ 'instrument-type': instrType, symbol: c.shortCallOccSymbol!, quantity: 1, action: 'Sell to Open' });
    legs.push({ 'instrument-type': instrType, symbol: c.longCallOccSymbol!, quantity: 1, action: 'Buy to Open' });
  } else if (c.strategy === 'PMCC') {
    // PMCC-0007: multi-expiration legs -- the LEAP and short call are on
    // different expiration cycles by construction (that's what makes it a
    // diagonal spread, not a vertical). Each leg's own OCC symbol already
    // encodes its own expiration; nothing else in the payload needs to
    // know the two legs span different cycles. TastyTrade's complex-order
    // API accepts this as a normal multi-leg order -- confirmed
    // empirically (Dean built this manually via the option chain earlier
    // this week, submitted as one net-debit combo order).
    legs.push({ 'instrument-type': instrType, symbol: c.longOccSymbolPMCC!, quantity: 1, action: 'Buy to Open' });
    legs.push({ 'instrument-type': instrType, symbol: c.shortOccSymbolPMCC!, quantity: 1, action: 'Sell to Open' });
  }
  return legs;
}

export function buildOrderPayload(c: SpreadCandidate, quantity: number, legs: any[]): any {
  if (c.strategy === 'PMCC') {
    // PMCC-0007: PMCC is a net DEBIT trade (you pay to open it -- the LEAP
    // costs more than the short call's credit) -- every other strategy
    // here is a net credit. c.netDebit is already computed by
    // findBestPMCC (long cost minus short credit); never re-derive it
    // from credit-per-contract math that only makes sense for a credit
    // structure.
    const debit = ((c.netDebit ?? 0) * quantity).toFixed(2);
    return {
      'time-in-force': 'GTC',
      'order-type': 'Limit',
      price: debit,
      'price-effect': 'Debit',
      legs: legs.map(l => ({ ...l, quantity })),
    };
  }
  const credit = ((c.totalCredit ?? c.credit) * quantity).toFixed(2);
  return {
    'time-in-force': 'GTC',
    'order-type': 'Limit',
    price: credit,
    'price-effect': 'Credit',
    legs: legs.map(l => ({ ...l, quantity })),
  };
}
