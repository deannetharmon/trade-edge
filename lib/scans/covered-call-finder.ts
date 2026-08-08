// lib/scans/covered-call-finder.ts
// TE-0007C — Covered Call as a first-class Screener strategy: candidate
// selection. Same convention as csp-finder.ts: the actual chain data comes
// from lib/wheel/chainSearch.ts (fetchWheelChain), reusing the exact same
// WheelChainResult/WheelChainLeg shapes the Wheel page's own CC-writing
// search uses — no second chain-fetching implementation exists.
//
// TE-0007C corrective round: this module's own SELECTION loop is no longer
// findBestWheelContract('own-writing-cc', ...) — that function picks a
// single delta-closest contract FIRST, then this module validated liquidity/
// quote-quality against only that one pick. If the delta-closest strike
// happened to be illiquid or one-sided, the whole search returned "no
// candidate" even when a second, slightly-less-delta-perfect contract in the
// same chain was fully eligible. Per the corrective ticket: "Filter the full
// candidate universe for every hard eligibility condition before choosing
// the best contract." findBestWheelContract (still used unmodified by the
// Wheel page itself — out of scope, not touched here) does not support that
// two-phase filter-then-select shape, so this module now owns its own
// selection loop, structured the same way (closest-|delta|-to-center wins)
// but over the FULL set of already-eligible candidates, not a single
// preselected one.
import type { WheelChainLeg } from '@/lib/wheel/chainSearch';
import type { SpreadCandidate } from './types';
import type { CcRulesType } from './constants';
import type { CoveredCallCapacity } from './covered-call-capacity';
import type { EligibilityDecision } from '@/lib/decision/types';
import { buildCandidateId } from './candidateIdentity';

function daysUntil(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export interface CcSelectedContract {
  expirationDate: string;
  dte: number;
  strikePrice: number;
  delta: number; // |delta|
  bid: number;
  ask: number;
  mid: number;
  openInterest: number;
  occSymbol: string;
}

interface CcEligibilityParams {
  deltaTarget: { min: number; max: number };
  dteTarget: { min: number; max: number };
  minStrike: number | null; // max(stockPrice, costBasis) — call must sit at/above this
  oiMin: number;
  bidAskMax: number;
}

// Hard gate check for ONE chain leg. Returns false for anything that must
// never be counted as an eligible candidate, full stop — never a
// warning/downgrade. Mirrors requirement #4's exact quote-validity contract:
// a one-sided (bid <= 0 XOR ask <= 0), crossed (ask < bid), missing, or
// non-finite quote can never support a reliable sell premium.
function isEligibleCcLeg(leg: WheelChainLeg, dte: number, p: CcEligibilityParams): boolean {
  if (leg.optionType !== 'C') return false;
  if (leg.delta == null) return false;

  const absDelta = Math.abs(leg.delta);
  if (absDelta < p.deltaTarget.min || absDelta > p.deltaTarget.max) return false;

  if (p.minStrike != null && leg.strikePrice < p.minStrike) return false;

  // TE-0007C corrective round: strict two-sided, non-crossed, finite quote —
  // replaces the old `bid <= 0 && ask <= 0` check, which accepted a
  // one-sided quote (e.g. bid 0, ask > 0) and computed a midpoint off it.
  if (!Number.isFinite(leg.bid) || !Number.isFinite(leg.ask)) return false;
  if (!(leg.bid > 0) || !(leg.ask > 0)) return false;
  if (leg.ask < leg.bid) return false; // crossed market

  if (leg.ask - leg.bid > p.bidAskMax) return false;
  if (leg.openInterest < p.oiMin) return false;

  return true;
}

// Filters the FULL chain for every hard eligibility condition (call leg, DTE
// window, delta window, strike floor, two-sided non-crossed finite quote,
// bid/ask width, minimum OI), and returns every surviving candidate sorted
// by preference (closest-to-target-delta-center first). A contract that
// fails any gate is simply never a candidate — it can never suppress a
// different, eligible contract from being found. Deterministic tie-breakers
// when multiple eligible contracts are equally close to the target delta
// center: (1) higher open interest, (2) narrower bid/ask width, (3) earlier
// expiration (lower DTE) — applied in that order so the result is
// reproducible.
//
// TE-0007C-RECONCILE-0001 — extracted so the full eligible-and-ranked
// candidate universe can be retained (findAllCoveredCalls, below), not just
// the single top pick. Behavior is byte-identical to what
// selectBestEligibleCcContract computed inline before this extraction --
// same gates, same sort, same tie-break order -- this is a pure
// refactor, not a policy change.
export function selectAllEligibleCcContracts(
  chain: { expirations: string[]; chains: Record<string, WheelChainLeg[]> },
  params: CcEligibilityParams,
): CcSelectedContract[] {
  const deltaCenter = (params.deltaTarget.min + params.deltaTarget.max) / 2;

  const eligible: CcSelectedContract[] = [];
  for (const expDate of chain.expirations) {
    const dte = daysUntil(expDate);
    if (dte < params.dteTarget.min || dte > params.dteTarget.max) continue;

    for (const leg of chain.chains[expDate] ?? []) {
      if (!isEligibleCcLeg(leg, dte, params)) continue;
      eligible.push({
        expirationDate: expDate,
        dte,
        strikePrice: leg.strikePrice,
        delta: Math.abs(leg.delta as number),
        bid: leg.bid,
        ask: leg.ask,
        mid: leg.mid,
        openInterest: leg.openInterest,
        occSymbol: leg.occSymbol,
      });
    }
  }

  eligible.sort((a, b) => {
    const distA = Math.abs(a.delta - deltaCenter);
    const distB = Math.abs(b.delta - deltaCenter);
    if (distA !== distB) return distA - distB; // 1. closest to target delta center wins
    if (a.openInterest !== b.openInterest) return b.openInterest - a.openInterest; // 2. higher OI wins
    const widthA = a.ask - a.bid, widthB = b.ask - b.bid;
    if (widthA !== widthB) return widthA - widthB; // 3. narrower bid/ask width wins
    return a.dte - b.dte; // 4. earlier expiration wins
  });

  return eligible;
}

// Filters the FULL chain for every hard eligibility condition (call leg, DTE
// window, delta window, strike floor, two-sided non-crossed finite quote,
// bid/ask width, minimum OI), THEN selects the single best remaining
// candidate by delta-distance-to-center. A contract that fails any gate is
// simply never a candidate — it can never suppress a different, eligible
// contract from being found. Deterministic tie-breakers when multiple
// eligible contracts are equally close to the target delta center: (1)
// higher open interest, (2) narrower bid/ask width, (3) earlier expiration
// (lower DTE) — applied in that order so the result is reproducible.
export function selectBestEligibleCcContract(
  chain: { expirations: string[]; chains: Record<string, WheelChainLeg[]> },
  params: CcEligibilityParams,
): CcSelectedContract | null {
  return selectAllEligibleCcContracts(chain, params)[0] ?? null;
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
//
// TE-0007C corrective round: `costBasis` here is already null unless
// covered-call-capacity.ts's normalizeEquityHoldings() confirmed EVERY
// contributing share has a known basis (CoveredCallCapacity.
// costBasisComplete) — so `minStrike`/`ccAssignmentWarning` below can treat
// "costBasis != null" as "costBasis is verified complete," never a partial
// average silently applied as if it covered the whole holding.
// TE-0007C-RECONCILE-0001 — pure candidate-economics builder, extracted
// unchanged from findBestCoveredCall's inline math so findAllCoveredCalls
// (below) can build a SpreadCandidate for every retained contract, not just
// the single best one. Every formula, rounding step, and field is
// byte-identical to what findBestCoveredCall computed inline before this
// extraction.
function buildCcSpreadCandidate(
  best: CcSelectedContract,
  params: CcFindParams,
  price: number | null,
  costBasis: number | null,
): SpreadCandidate {
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
  // TE-0007C corrective round: fires both when cost basis is entirely
  // unavailable AND when it's only partially known (costBasis is null in
  // both cases — see CoveredCallCapacity.costBasisComplete) — a partial
  // basis is exactly as unusable for assignment-economics display as a
  // fully unknown one, so the warning text covers both explicitly.
  const ccAssignmentWarning = costBasis == null
    ? 'Cost basis unavailable or incomplete — assignment economics against your original cost could not be verified'
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
    ccHasUnclassifiedExposure: params.capacity.hasUnclassifiedExposure,
  };
}

export function findBestCoveredCall(
  chain: { expirations: string[]; chains: Record<string, WheelChainLeg[]> },
  params: CcFindParams,
): SpreadCandidate | null {
  // No capacity -> no candidate, full stop. This function must never search
  // for or return a strike that would exceed available coverage.
  if (params.capacity.availableCoveredContracts <= 0) return null;
  if (params.earningsWithinExpiry) return null;

  // Never select ITM, never below cost basis -- enforced by filtering the
  // FULL SEARCH SPACE up front (see selectBestEligibleCcContract), not by
  // validating a single already-chosen pick after the fact. This is what
  // lets a second, less delta-perfect but fully eligible contract be found
  // when the single delta-closest strike would otherwise fail a liquidity/
  // quote/strike gate and (in the old flow) suppress the whole search.
  const price = params.stockPrice;
  const costBasis = params.capacity.costBasis;
  const candidateMins = [price, costBasis].filter((v): v is number => v != null);
  const minStrike = candidateMins.length > 0 ? Math.max(...candidateMins) : null;

  const best = selectBestEligibleCcContract(chain, {
    deltaTarget: { min: params.rules.DELTA_MIN, max: params.rules.DELTA_MAX },
    dteTarget: { min: params.rules.DTE_MIN, max: params.rules.DTE_MAX },
    minStrike,
    oiMin: params.rules.OI_MIN,
    bidAskMax: params.rules.BID_ASK_MAX,
  });
  if (!best) return null;

  return buildCcSpreadCandidate(best, params, price, costBasis);
}

// ── SQ-0001A foundation gate + multi-candidate discovery ────────────────
// TE-0007C-RECONCILE-0001.
//
// CcMarketQualification is the "CC Market Eligibility" axis from the frozen
// architecture diagram: is the underlying/thesis evidence appropriate for
// writing a call at all, independent of (a) whether this account owns
// enough shares (that's capacity — CoveredCallCapacity, untouched by this
// gate) and (b) whether a specific contract's economics are acceptable
// (that's the existing hard gates in isEligibleCcLeg, also untouched).
export type CcMarketQualification =
  | 'QUALIFIED'
  | 'DISQUALIFIED_FOUNDATION_INELIGIBLE'
  | 'DISQUALIFIED_FOUNDATION_INSUFFICIENT_EVIDENCE';

// Mirrors csp-finder.ts's marketQualificationFor exactly: an explicitly
// supplied foundation decision can disqualify; a missing one (undefined/
// null — no caller has wired real evidence in yet) never gates anything,
// so every existing findBestCoveredCall caller is unaffected.
function ccMarketQualificationFor(foundationEligibility?: EligibilityDecision | null): CcMarketQualification {
  if (foundationEligibility) {
    if (foundationEligibility.status === 'INSUFFICIENT_EVIDENCE') return 'DISQUALIFIED_FOUNDATION_INSUFFICIENT_EVIDENCE';
    if (foundationEligibility.status === 'INELIGIBLE') return 'DISQUALIFIED_FOUNDATION_INELIGIBLE';
  }
  return 'QUALIFIED';
}

export interface CcFindAllParams extends CcFindParams {
  /** Needed to build each candidate's stable identity. */
  underlyingSymbol: string;
  /** SQ-0001A foundation eligibility for this underlying/horizon — same
   * once-per-symbol, optional, opt-in convention as csp-finder.ts's
   * CspFindParams.foundationEligibility. */
  foundationEligibility?: EligibilityDecision | null;
}

export interface CcCandidateResult {
  candidateId: string;
  candidate: SpreadCandidate;
  marketQualification: CcMarketQualification;
}

// TE-0007C-RECONCILE-0001 — the multi-candidate discovery entry point the
// frozen architecture requires ("discover → qualify → retain candidate
// universe → rank"), sitting alongside (not replacing) the still-used
// findBestCoveredCall. Retains EVERY contract that survives the existing
// hard eligibility gates for this symbol, not just the single best — the
// same "discovery before classification" shape CSP-WORKFLOW-0001
// established for CSP. Capacity/earnings behavior deliberately matches
// findBestCoveredCall's existing, already-approved short-circuit (zero
// capacity or earnings-in-window means no candidate at all is returned,
// not a disqualified-but-visible one) — changing that product behavior is
// out of this work item's scope; see the reconciliation report's Remaining
// Concerns for the question of whether CC should adopt CSP's
// visible-but-disqualified-on-capacity presentation in a future ticket.
export function findAllCoveredCalls(
  chain: { expirations: string[]; chains: Record<string, WheelChainLeg[]> },
  params: CcFindAllParams,
): { results: CcCandidateResult[] } {
  if (params.capacity.availableCoveredContracts <= 0) return { results: [] };
  if (params.earningsWithinExpiry) return { results: [] };

  const price = params.stockPrice;
  const costBasis = params.capacity.costBasis;
  const candidateMins = [price, costBasis].filter((v): v is number => v != null);
  const minStrike = candidateMins.length > 0 ? Math.max(...candidateMins) : null;

  const eligible = selectAllEligibleCcContracts(chain, {
    deltaTarget: { min: params.rules.DELTA_MIN, max: params.rules.DELTA_MAX },
    dteTarget: { min: params.rules.DTE_MIN, max: params.rules.DTE_MAX },
    minStrike,
    oiMin: params.rules.OI_MIN,
    bidAskMax: params.rules.BID_ASK_MAX,
  });

  // Computed once per symbol (per the params contract), applied uniformly
  // to every candidate discovered for that symbol — mirrors csp-finder.ts's
  // marketQualificationFor convention exactly.
  const marketQualification = ccMarketQualificationFor(params.foundationEligibility);

  const results: CcCandidateResult[] = eligible.map((best) => {
    const candidate = buildCcSpreadCandidate(best, params, price, costBasis);
    const candidateId = buildCandidateId({
      occSymbol: best.occSymbol,
      strategy: 'CC',
      underlyingSymbol: params.underlyingSymbol,
      expiration: best.expirationDate,
      optionType: 'call',
      strike: best.strikePrice,
    });
    return { candidateId, candidate, marketQualification };
  });

  return { results };
}
