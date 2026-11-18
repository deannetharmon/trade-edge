// lib/trademap/candidateLink.ts
//
// OPTMAP-0001 S2e: maps a screener candidate to a Trade Map link. Only what the
// candidate states exactly is passed: BPS, BCS and CSP carry their strikes; an
// iron condor opens on the symbol and expiry only (its call side is not in the
// candidate, so the Trade Map must not guess it). Anything unrecognised is
// dropped, never guessed.

import { buildTradeMapUrl, type TradeMapPrefill } from './deepLink';
import type { StrategyId } from './strategies';

export interface CandidateLike {
  strategy?: string | null;
  expiration?: string | null;
  shortStrike?: number | null;
  longStrike?: number | null;
}

const STRATEGY_BY_CODE: Record<string, StrategyId> = { BPS: 'bps', BCS: 'bcs', IC: 'ic', CSP: 'csp' };

export function candidateToPrefill(symbol: string, c?: CandidateLike | null): TradeMapPrefill {
  const out: TradeMapPrefill = { symbol };
  if (!c) return out;
  const code = (c.strategy ?? '').toUpperCase();
  const strategy = STRATEGY_BY_CODE[code];
  if (strategy) out.strategy = strategy;
  if (c.expiration && /^\d{4}-\d{2}-\d{2}$/.test(c.expiration)) out.expiry = c.expiration;
  const exactStrikes = strategy === 'bps' || strategy === 'bcs' || strategy === 'csp';
  if (exactStrikes && c.shortStrike != null && c.shortStrike > 0) {
    out.strike = c.shortStrike;
    if (strategy !== 'csp' && c.longStrike != null && c.longStrike > 0 && c.longStrike !== c.shortStrike) out.longStrike = c.longStrike;
  }
  return out;
}

export function candidateTradeMapUrl(symbol: string, c?: CandidateLike | null): string {
  return buildTradeMapUrl(candidateToPrefill(symbol, c));
}
