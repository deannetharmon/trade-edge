// lib/wheel/planPut.ts
//
// WHEEL-SYSTEM-0001 (W1) -- which put the plan prices, and what state each ladder row is in.
//
// Strike rule (Dane, review of draft 1): among the expirations already fetched inside the DTE window, the put
// whose absolute delta is nearest the target; a tie goes to the nearer expiry, then to the lower strike. A leg
// with no delta, or with bid = 0 and ask = 0 (a dead quote), is skipped. A put further than MAX_DELTA_DISTANCE
// from the target is not used: "no put found" is honest, a 0.05-delta put is not the plan's put.
// W1 applies no open-interest or bid-ask filter (W2 owns filters).
//
// A failed greeks batch must never look like "no put found" (Quinn): the row says "chain error".

import type { WheelChainLeg, WheelChainResult } from './chainSearch';

export const MAX_DELTA_DISTANCE_BPS = 1000; // 0.10

export interface PlanPut {
  leg: WheelChainLeg;
  expirationDate: string;
  /** Absolute delta in basis points. */
  deltaBps: number;
}

export function selectPlanPut(chain: WheelChainResult, targetDeltaBps: number): PlanPut | null {
  let best: PlanPut | null = null;
  let bestDistance = Infinity;
  for (const expirationDate of chain.expirations) {
    for (const leg of chain.chains[expirationDate] ?? []) {
      if (leg.optionType !== 'P') continue;
      if (leg.delta == null || !Number.isFinite(leg.delta)) continue;
      if (leg.bid === 0 && leg.ask === 0) continue;
      const deltaBps = Math.round(Math.abs(leg.delta) * 10_000);
      const distance = Math.abs(deltaBps - targetDeltaBps);
      if (distance > MAX_DELTA_DISTANCE_BPS) continue;
      const better =
        best === null ||
        distance < bestDistance ||
        // Same distance: the nearer expiry wins (expirations are ascending, so keep the first seen); within one
        // expiry the lower strike wins.
        (distance === bestDistance && expirationDate === best.expirationDate && leg.strikePrice < best.leg.strikePrice);
      if (better) {
        best = { leg, expirationDate, deltaBps };
        bestDistance = distance;
      }
    }
  }
  return best;
}

export type FetchOutcome = {
  quote: number | null;
  chain: WheelChainResult | null;
  /** Set when the chain fetch threw. */
  chainError: string | null;
};

export type RowStatus =
  | { kind: 'ok'; put: PlanPut }
  | { kind: 'chain-error'; message: string }
  | { kind: 'quote-unavailable' }
  | { kind: 'no-put' };

/** Turns raw fetch results into one honest row state. Chain trouble outranks everything else. */
export function classifyRow(outcome: FetchOutcome, targetDeltaBps: number): RowStatus {
  if (outcome.chainError) return { kind: 'chain-error', message: outcome.chainError };
  if (!outcome.chain) return { kind: 'chain-error', message: 'No option chain was returned.' };
  const put = selectPlanPut(outcome.chain, targetDeltaBps);
  if (put) return { kind: 'ok', put };
  if ((outcome.chain.failedBatches ?? 0) > 0) {
    return { kind: 'chain-error', message: 'Some option quotes failed to load, so no put could be chosen. Retry.' };
  }
  if (outcome.quote == null) return { kind: 'quote-unavailable' };
  return { kind: 'no-put' };
}
