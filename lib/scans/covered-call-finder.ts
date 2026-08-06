// lib/scans/covered-call-finder.ts
// TE-0007C — Covered Call as a first-class Screener strategy: candidate
// selection. Deliberately thin, same convention as csp-finder.ts: the actual
// delta/DTE contract search is NOT reimplemented here — it calls straight
// into lib/wheel/chainSearch.ts's findBestWheelContract('own-writing-cc', ...),
// the same function the Wheel page uses to hunt CC-writing strikes.
//
// This module owns only CC-specific selection rules on top of that search:
// liquidity/quote-quality gates, "never select ITM by default", "never
// recommend below cost basis", and turning the result into the shared
// SpreadCandidate shape with CC-specific fields populated.
import { findBestWheelContract, type WheelChainResult, type WheelDeltaTarget, type WheelDteTarget } from '@/lib/wheel/chainSearch';
import type { SpreadCandidate } from './types';
import type { CcRulesType } from './constants';
import type { CoveredCallCapacity } from './covered-call-capacity';

function toWheelChainResult(chain: { expirations: string[]; chains: Record<string, any[]> }): WheelChainResult {
  return chain as unknown as WheelChainResult;
}

export interface CcFindParams {
  rules: CcRulesType;
  capacity: CoveredCallCapacity; // availableCoveredContracts caps quantity; never exceeded
  stockPrice: number | null;
  earningsDate?: string | null;
  earningsWithinExpiry?: boolean; // caller-computed, same convention as CSP's earnings check
}

// Returns the single best CC candidate across the DTE window in
// `params.rules`, honoring capacity, or null if nothing qualifies. Per the
// ticket: "Return no candidate rather than guessing or falling back to an
// ineligible strike." Every rejection reason below is a hard gate, not a
// warning — a candidate that fails any of these is NOT returned at all.
export function findBestCoveredCall(
  chain: { expirations: string[]; chains: Record<string, any[]> },
  params: CcFindParams,
): SpreadCandidate | null {
  // No capacity -> no candidate, full stop. This function must never search
  // for or return a strike that would exceed available coverage.
  if (params.capacity.availableCoveredContracts <= 0) return null;
  if (params.earningsWithinExpiry) return null;

  const deltaTarget: WheelDeltaTarget = { min: params.rules.DELTA_MIN, max: params.rules.DELTA_MAX };
  const dteTarget: WheelDteTarget = { min: params.rules.DTE_MIN, max: params.rules.DTE_MAX };

  const best = findBestWheelContract(toWheelChainResult(chain), 'own-writing-cc', deltaTarget, dteTarget);
  if (!best) return null;

  // Liquidity / quote-quality gates.
  if (best.openInterest < params.rules.OI_MIN) return null;
  if (best.bid <= 0 && best.ask <= 0) return null; // fully unusable quote
  if (best.ask < best.bid) return null; // crossed market
  if (best.ask - best.bid > params.rules.BID_ASK_MAX) return null;

  const price = params.stockPrice;
  const costBasis = params.capacity.costBasis;

  // Default strike behavior: never select an in-the-money call, and never
  // recommend a strike below current stock price.
  if (price != null && best.strikePrice < price) return null;

  // Never recommend a strike below known cost basis. Missing cost basis does
  // not by itself suppress the candidate — it's disclosed via the warning
  // fields on the returned candidate instead (handled by the caller/UI,
  // since this function has no warning-string field to attach it to besides
  // ccAssignmentWarning below).
  if (costBasis != null && best.strikePrice < costBasis) return null;

  const contracts = params.capacity.availableCoveredContracts;
  const premiumPerShare = parseFloat(best.mid.toFixed(4));
  const premiumPerContract = parseFloat((premiumPerShare * 100).toFixed(2));
  const totalPremium = parseFloat((premiumPerContract * contracts).toFixed(2));

  const periodYieldOnShares = price != null && price > 0 ? (premiumPerShare / price) * 100 : null;
  const annualizedYieldOnShares = periodYieldOnShares != null && best.dte > 0
    ? periodYieldOnShares * (365 / best.dte)
    : null;

  const strikeVsStockPct = price != null && price > 0 ? ((best.strikePrice - price) / price) * 100 : null;
  const strikeVsCostBasisPct = costBasis != null && costBasis > 0
    ? ((best.strikePrice - costBasis) / costBasis) * 100
    : null;

  const assignmentProceeds = best.strikePrice * 100;
  const maxUpsideIfCalledAway = costBasis != null
    ? parseFloat((best.strikePrice - costBasis + premiumPerShare).toFixed(4))
    : null;

  const bidAskWidth = parseFloat((best.ask - best.bid).toFixed(4));
  const ccLiquidityWarning = best.openInterest < params.rules.OI_MIN * 2
    ? `Open interest ${best.openInterest} is thin — fills may be difficult`
    : null;
  const ccAssignmentWarning = costBasis == null
    ? 'Cost basis unavailable — assignment economics against your original cost could not be verified'
    : null;

  return {
    strategy: 'CC',
    expiration: best.expirationDate,
    dte: best.dte,
    shortStrike: best.strikePrice,
    longStrike: best.strikePrice,
    shortDelta: best.delta,
    credit: totalPremium,
    spreadWidth: 0,
    creditRatio: 0,
    roc: periodYieldOnShares ?? 0,
    // Reuses the existing shared `annualizedRoc` field (already rendered by
    // the CSP branch of the shared result-card row) so CC's annualized yield
    // shows up in the summary row without touching that row's ternary logic.
    annualizedRoc: annualizedYieldOnShares ?? 0,
    pop: (1 - best.delta) * 100,
    shortOI: best.openInterest,
    longOI: best.openInterest,
    shortOccSymbol: best.occSymbol,
    longOccSymbol: undefined, // no live execution for CC (TE-0007C scope)
    shortBid: best.bid,
    shortAsk: best.ask,
    optimized: true,

    // CC-specific (TE-0007C)
    ccSharesOwned: params.capacity.sharesOwned,
    ccGrossCoveredContracts: params.capacity.grossCoveredContracts,
    ccExistingShortCallContracts: params.capacity.existingShortCallContracts,
    ccWorkingShortCallContracts: params.capacity.workingShortCallContracts,
    ccAvailableCoveredContracts: params.capacity.availableCoveredContracts,
    ccCostBasis: costBasis,
    ccPremiumPerShare: premiumPerShare,
    ccPremiumPerContract: premiumPerContract,
    ccPeriodYieldOnShares: periodYieldOnShares,
    ccAnnualizedYieldOnShares: annualizedYieldOnShares,
    ccStrikeVsStockPct: strikeVsStockPct,
    ccStrikeVsCostBasisPct: strikeVsCostBasisPct,
    ccMaxUpsideIfCalledAway: maxUpsideIfCalledAway,
    ccAssignmentProceeds: assignmentProceeds,
    ccBidAskWidth: bidAskWidth,
    ccLiquidityWarning,
    ccAssignmentWarning,
  };
}
