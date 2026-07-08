// lib/scans/csp-finder.ts
// TE-0007A — CSP as a first-class Screener strategy.
//
// Deliberately thin: the actual contract search (delta-target matching across
// a DTE window) is NOT reimplemented here. It calls straight into
// lib/wheel/chainSearch.ts's findBestWheelContract, the same function the
// Wheel page uses to hunt CSP entries. That function only reads
// {strikePrice, delta, bid, ask, mid, openInterest, occSymbol, expirationDate,
// optionType} off each leg, which is a strict subset of the leg shape
// Screener's getChain() already returns — so the Screener's chain can be
// passed in as-is (see toWheelChainResult below).
import { findBestWheelContract, type WheelChainResult, type WheelDeltaTarget, type WheelDteTarget } from '@/lib/wheel/chainSearch';
import type { SpreadCandidate } from './types';
import type { CspRulesType } from './constants';

// Screener's getChain() leg objects have every field WheelChainLeg needs,
// plus extras (iv, fetchedAt, quoteUpdatedAt) that findBestWheelContract
// simply ignores. No remapping needed — this cast documents that fact
// rather than performing any real transformation.
function toWheelChainResult(chain: { expirations: string[]; chains: Record<string, any[]> }): WheelChainResult {
  return chain as unknown as WheelChainResult;
}

export interface CspFindParams {
  rules: CspRulesType;
  contracts?: number;          // default 1 — sizing happens at trade time, not scan time
  availableCash?: number | null; // null/undefined = unknown; skip capital gating but still compute requiredCash
}

// Mirrors findBestSpread's contract: given a chain already fetched for one
// symbol, return the single best CSP candidate across the DTE window in
// `params.rules`, or null if nothing in the chain qualifies on delta/DTE.
// Capital gating (requiredCash vs availableCash) never disqualifies a
// candidate — insufficient cash is surfaced as a warning/blocked flag on the
// result so the trader still sees the opportunity, per DR-0001 §7.4:
// "show the candidate as unavailable or blocked" rather than hiding it.
export function findBestCsp(
  chain: { expirations: string[]; chains: Record<string, any[]> },
  price: number | null,
  params: CspFindParams,
): SpreadCandidate | null {
  const contracts = params.contracts ?? 1;
  const deltaTarget: WheelDeltaTarget = { min: params.rules.DELTA_MIN, max: params.rules.DELTA_MAX };
  const dteTarget: WheelDteTarget = { min: params.rules.DTE_MIN, max: params.rules.DTE_MAX };

  const best = findBestWheelContract(toWheelChainResult(chain), 'hunting-csp', deltaTarget, dteTarget);
  if (!best) return null;

  // Liquidity/spread gates — same conventions as spread-finder.ts's checks,
  // applied here since findBestWheelContract itself doesn't gate on them.
  if (best.openInterest < params.rules.OI_MIN) return null;
  if (best.ask - best.bid > params.rules.BID_ASK_MAX) return null;

  const premiumPerContract = parseFloat((best.mid * 100).toFixed(2));
  const totalPremium = parseFloat((premiumPerContract * contracts).toFixed(2));
  const requiredCash = best.strikePrice * 100 * contracts;
  const roc = requiredCash > 0 ? (totalPremium / requiredCash) * 100 : 0;
  const annualizedRoc = best.dte > 0 ? roc * (365 / best.dte) : 0;
  const breakeven = parseFloat((best.strikePrice - best.mid).toFixed(2));

  const capitalBlocked = params.availableCash != null && requiredCash > params.availableCash;
  const capitalWarning = capitalBlocked
    ? `Insufficient cash — requires $${requiredCash.toLocaleString()}, $${Math.max(0, params.availableCash ?? 0).toLocaleString()} available. Margin is not used by default.`
    : null;

  return {
    strategy: 'CSP',
    expiration: best.expirationDate,
    dte: best.dte,
    shortStrike: best.strikePrice,
    longStrike: best.strikePrice, // no long leg — kept equal to short so shared math (e.g. width = 0) stays sane
    shortDelta: best.delta,
    credit: totalPremium,
    spreadWidth: 0,
    creditRatio: requiredCash > 0 ? totalPremium / requiredCash : 0,
    roc,
    pop: (1 - best.delta) * 100,
    shortOI: best.openInterest,
    longOI: best.openInterest,
    shortOccSymbol: best.occSymbol,
    longOccSymbol: undefined, // deliberately unset — disables the Trade/OTOCO path (hasOccSymbols check), no live execution for CSP yet
    shortBid: best.bid,
    shortAsk: best.ask,
    optimized: true,
    requiredCash,
    annualizedRoc,
    breakeven,
    assignmentPrice: best.strikePrice,
    capitalBlocked,
    capitalWarning,
  };
}
