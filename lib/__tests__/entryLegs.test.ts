// lib/__tests__/entryLegs.test.ts
//
// ORDER-SEND-0001 Step 0: golden legs for every strategy the screener can open. The function
// was moved verbatim out of app/screener/page.tsx; these fixtures pin its exact output
// (instrument type, quantity 1, actions, space-padded OCC symbols) so any later change shows up.

import { describe, expect, it } from 'vitest';
import { buildOrderLegs } from '../orders/entryLegs';
import { buildCreditEntryOtoco } from '../screener/entryBracket';

const r = (underlyingType: string): any => ({ symbol: 'SOXL', underlyingType });
const SP = 'SOXL  261218P00045000';
const LP = 'SOXL  261218P00040000';
const SC = 'SOXL  261218C00055000';
const LC = 'SOXL  261218C00060000';
const leg = (symbol: string, action: string, type = 'Equity Option') => ({ 'instrument-type': type, symbol, quantity: 1, action });

describe('ORDER-SEND-0001 Step 0: buildOrderLegs', () => {
  it('BPS and BCS: sell the short, buy the long', () => {
    const c: any = { strategy: 'BPS', shortOccSymbol: SP, longOccSymbol: LP };
    expect(buildOrderLegs(r('equity'), c)).toEqual([leg(SP, 'Sell to Open'), leg(LP, 'Buy to Open')]);
    expect(buildOrderLegs(r('equity'), { ...c, strategy: 'BCS' })).toEqual([leg(SP, 'Sell to Open'), leg(LP, 'Buy to Open')]);
  });
  it('IC: put side then call side, with the padded symbols untouched', () => {
    const c: any = { strategy: 'IC', shortOccSymbol: SP, longOccSymbol: LP, shortCallOccSymbol: SC, longCallOccSymbol: LC };
    expect(buildOrderLegs(r('equity'), c)).toEqual([
      leg(SP, 'Sell to Open'), leg(LP, 'Buy to Open'), leg(SC, 'Sell to Open'), leg(LC, 'Buy to Open'),
    ]);
  });
  it('CSP is exactly one leg', () => {
    expect(buildOrderLegs(r('equity'), { strategy: 'CSP', shortOccSymbol: SP } as any)).toEqual([leg(SP, 'Sell to Open')]);
  });
  it('PMCC prefers the PMCC-specific symbols and falls back to the generic ones', () => {
    const c: any = { strategy: 'PMCC', shortOccSymbolPMCC: SC, longOccSymbolPMCC: LC, shortOccSymbol: 'X', longOccSymbol: 'Y' };
    expect(buildOrderLegs(r('equity'), c)).toEqual([leg(SC, 'Sell to Open'), leg(LC, 'Buy to Open')]);
    expect(buildOrderLegs(r('equity'), { strategy: 'PMCC', shortOccSymbol: SC, longOccSymbol: LC } as any)).toEqual([leg(SC, 'Sell to Open'), leg(LC, 'Buy to Open')]);
  });
  it('an index underlying uses the Index Option instrument type; unknown strategies give no legs', () => {
    expect(buildOrderLegs(r('index'), { strategy: 'CSP', shortOccSymbol: SP } as any)).toEqual([leg(SP, 'Sell to Open', 'Index Option')]);
    expect(buildOrderLegs(r('equity'), { strategy: 'NO_TRADE' } as any)).toEqual([]);
  });
  it('feeds the bracketed credit-entry builder: closing legs mirror the opening legs', () => {
    const legs = buildOrderLegs(r('equity'), { strategy: 'BPS', shortOccSymbol: SP, longOccSymbol: LP } as any);
    const o: any = buildCreditEntryOtoco({ entryCredit: 1, profitBuyback: 0.5, stopTrigger: 2, stopLimit: 2.1, quantity: 2, legs });
    expect(o['trigger-order'].legs.map((l: any) => [l.symbol, l.action, l.quantity])).toEqual([[SP, 'Sell to Open', 2], [LP, 'Buy to Open', 2]]);
    expect(o.orders[0].legs.map((l: any) => [l.symbol, l.action])).toEqual([[SP, 'Buy to Close'], [LP, 'Sell to Close']]);
  });
});
