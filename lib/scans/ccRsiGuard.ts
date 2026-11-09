// lib/scans/ccRsiGuard.ts
// CC-RSI-GUARD-0001 -- the stop shown before an order screen opens for a covered call or a PMCC short call.
// Pure. Same cutoff as the Ready / Wait chip (default 50). A speed bump, not a block: the caller always offers
// "Sell anyway". RSI at or above the cutoff passes silently. RSI that cannot be read stops too (fail closed).
import { sanitizeCcRsiCutoff } from '@/lib/scans/ccRsiChip';

export type CcRsiGuardDecision =
  | { stop: false }
  | { stop: true; kind: 'below' | 'unreadable'; rsi: number | null; cutoff: number; title: string; body: string };

export function decideCcRsiGuard(input: { symbol: string; rsi: number | null | undefined; cutoff?: number }): CcRsiGuardDecision {
  const cutoff = sanitizeCcRsiCutoff(input.cutoff);
  const symbol = input.symbol;
  const { rsi } = input;
  const title = `Stop. Look at ${symbol} first.`;
  if (typeof rsi !== 'number' || !Number.isFinite(rsi)) {
    return {
      stop: true, kind: 'unreadable', rsi: null, cutoff, title,
      body: `The app could not read ${symbol}'s daily RSI, so it can't confirm the stock is above your ${cutoff} cutoff. Check the chart yourself before you sell a call.`,
    };
  }
  if (rsi < cutoff) {
    return {
      stop: true, kind: 'below', rsi, cutoff, title,
      body: `You generally want RSI above ${cutoff} before you sell a call. Below it the stock is weak, and the call pays less for the same risk. Go back and look at the chart, then decide.`,
    };
  }
  return { stop: false };
}
