// lib/orders/entryLegs.ts
//
// ORDER-SEND-0001 Step 0: the opening legs of a screener candidate, moved verbatim out of
// app/screener/page.tsx (mechanical move, no logic change). buildCreditEntryOtoco
// (lib/screener/entryBracket.ts) turns these legs into the bracketed broker order.

import type { ScreenResult, SpreadCandidate } from '@/lib/scans/types';

export function buildOrderLegs(result: ScreenResult, c: SpreadCandidate): any[] {
  const instrType = result.underlyingType === 'index' ? 'Index Option' : 'Equity Option';
  const legs: any[] = [];
  if (c.strategy === 'PMCC') {
    legs.push({ 'instrument-type': instrType, symbol: c.shortOccSymbolPMCC || c.shortOccSymbol!, quantity: 1, action: 'Sell to Open' });
    legs.push({ 'instrument-type': instrType, symbol: c.longOccSymbolPMCC || c.longOccSymbol!, quantity: 1, action: 'Buy to Open' });
  } else if (c.strategy === 'BPS') {
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
  } else if (c.strategy === 'CSP') {
    // CSP-ORDERS-0001 -- a cash-secured put is a single leg, deliberately
    // never more. buildCreditEntryOtoco (lib/screener/entryBracket.ts) is
    // already leg-count-agnostic, so no change was needed there.
    legs.push({ 'instrument-type': instrType, symbol: c.shortOccSymbol!, quantity: 1, action: 'Sell to Open' });
  }
  return legs;
}
