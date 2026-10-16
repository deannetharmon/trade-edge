// lib/tradeLookup/chainRows.ts

// TRADE-LOOKUP-0001B: turns the broker chain that lib/scans/tastytrade-client.ts getChain() already returns
// ({ [expirationDate]: rows[] }) into the lookup's own ChainRow shape. Pure. No network.
//
// getChain reports a missing bid or ask as 0, so a bid of 0 with an ask of 0 is "no quote", and the
// lookup treats it that way (see buildLookup.ts). A non-numeric field becomes null here, never 0.

import type { ChainRow } from './lookupTypes';

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return isFinite(n) ? n : null;
}

/** Rows from getChain().chains. Skips anything without a real strike, a P/C right or an expiration. */
export function normalizeChainRows(chains: Record<string, unknown[]> | null | undefined): ChainRow[] {
  const out: ChainRow[] = [];
  if (!chains) return out;
  const expirations = Object.keys(chains);
  for (let i = 0; i < expirations.length; i++) {
    const list = chains[expirations[i]] || [];
    for (let j = 0; j < list.length; j++) {
      const raw = list[j] as Record<string, unknown> | null;
      if (!raw) continue;
      const strike = num(raw.strikePrice);
      const right = raw.optionType === 'P' || raw.optionType === 'C' ? raw.optionType : null;
      const expiration = typeof raw.expirationDate === 'string' && raw.expirationDate !== '' ? raw.expirationDate : expirations[i];
      if (strike === null || strike <= 0 || right === null || !/^\d{4}-\d{2}-\d{2}$/.test(expiration)) continue;
      out.push({
        strike,
        right,
        expiration,
        bid: num(raw.bid),
        ask: num(raw.ask),
        delta: num(raw.delta),
        openInterest: num(raw.openInterest),
        iv: num(raw.iv),
        occSymbol: typeof raw.occSymbol === 'string' ? raw.occSymbol : '',
        quoteUpdatedAt: typeof raw.quoteUpdatedAt === 'string' ? raw.quoteUpdatedAt : null,
      });
    }
  }
  return out;
}
