// lib/scans/ccBlocked.ts
//
// CC-VISIBILITY-0001 slice 4 -- the calls the safety checks keep out of the strike grid, each with its own plain reason, so a call
// you can see in your broker (or another tool) is never just missing. Display only: nothing here makes a call eligible, and the
// scan and the order path are untouched. Uses the same rejection function as the scan (ccLegRejection), so the reason shown is
// always the rule that actually removed the call.
//
// Listed: calls at or above the stock price, inside the scan's DTE window, rejected for no market (zero open interest), no usable
// quote (one-sided or crossed) or no delta. Not listed: calls below the stock price (in the money), calls below your cost basis
// (the grid's "Show below cost basis" switch covers them) and calls the delta or width view hides (the result filters list those).

import type { WheelChainLeg } from '@/lib/wheel/chainSearch';
import { ccLegRejection, type CcEligibilityParams } from './covered-call-finder';

export type CcBlockedReason = 'no-market' | 'no-quote' | 'crossed-quote' | 'no-delta';

export interface CcBlockedCall {
  expiration: string;
  dte: number;
  strike: number;
  bid: number | null;
  ask: number | null;
  openInterest: number | null;
  reason: CcBlockedReason;
}

export const CC_BLOCKED_LIMIT = 40;

const REASON: Record<string, CcBlockedReason | undefined> = { BAD_OI: 'no-market', BAD_QUOTE: 'no-quote', CROSSED_QUOTE: 'crossed-quote', NO_DELTA: 'no-delta' };

const finiteOrNull = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) ? n : null);

function daysUntil(dateStr: string, today: Date = new Date()): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d).getTime() - start.getTime()) / 86_400_000);
}

export function listCcBlockedCalls(
  chain: { expirations: string[]; chains: Record<string, WheelChainLeg[]> },
  input: { dteMin: number; dteMax: number; stockPrice: number | null; today?: Date },
): { calls: CcBlockedCall[]; total: number } {
  if (!(typeof input.stockPrice === 'number' && input.stockPrice > 0)) return { calls: [], total: 0 };
  // Every view-independent rule except the strike floor, which is the grid's own switch.
  const params: CcEligibilityParams = {
    deltaTarget: { min: 0, max: 1 }, dteTarget: { min: input.dteMin, max: input.dteMax }, minStrike: null, oiMin: 0, widthPctMax: 100, widthCeiling: 1000,
  };
  const all: CcBlockedCall[] = [];
  for (const expiration of chain.expirations) {
    const dte = daysUntil(expiration, input.today);
    if (dte < input.dteMin || dte > input.dteMax) continue;
    for (const leg of chain.chains[expiration] ?? []) {
      if (!Number.isFinite(leg.strikePrice) || leg.strikePrice < input.stockPrice) continue;
      const reason = REASON[ccLegRejection(leg, dte, params) ?? ''];
      if (!reason) continue;
      all.push({ expiration, dte, strike: leg.strikePrice, bid: finiteOrNull(leg.bid), ask: finiteOrNull(leg.ask), openInterest: finiteOrNull(leg.openInterest), reason });
    }
  }
  all.sort((a, b) => a.expiration.localeCompare(b.expiration) || a.strike - b.strike);
  return { calls: all.slice(0, CC_BLOCKED_LIMIT), total: all.length };
}

/** One plain sentence per blocked call. */
export function describeCcBlocked(c: CcBlockedCall): string {
  const lead = `$${Number.isInteger(c.strike) ? c.strike : c.strike.toFixed(2)} · ${c.expiration} · ${c.dte} DTE`;
  const quote = c.bid !== null && c.ask !== null ? `bid $${c.bid.toFixed(2)} / ask $${c.ask.toFixed(2)}` : 'no quote';
  switch (c.reason) {
    case 'no-market': return `${lead} — no open interest, so no real market; the quote (${quote}) cannot be trusted`;
    case 'no-quote': return `${lead} — no two-sided quote (${quote}), so there is no reliable premium`;
    case 'crossed-quote': return `${lead} — crossed quote (${quote})`;
    case 'no-delta': return `${lead} — the broker gave no delta, so the risk cannot be measured`;
  }
}
