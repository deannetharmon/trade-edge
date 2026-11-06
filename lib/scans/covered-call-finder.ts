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
import { hasOpenInterestMarket } from './liquidityPolicy';
import type { WheelChainLeg } from '@/lib/wheel/chainSearch';
import type { SpreadCandidate } from './types';
import type { CcRulesType } from './constants';
import type { CoveredCallCapacity } from './covered-call-capacity';
import type { EligibilityDecision } from '@/lib/decision/types';
import { buildCandidateId } from './candidateIdentity';
import { ccStrikeFloor } from './ccStrikeFloor';
import type { CcGrid, CcGridCell } from './ccGridTypes';
import { assessOiLiquidity } from './oiLiquidity';
import { evaluateHybridSpread } from './hybridSpread';
import { earningsOnOrBeforeExpiration, EARNINGS_MIN_DAYS_AFTER_EXPIRY } from './earningsPrecheck';

// SCAN-ALIGN-0001C2 -- the warn percent is unused for CC eligibility (CC has no width warning);
// the shared function only needs it to be well-formed.
const CC_WARN_PCT_UNUSED = 5;

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

export interface CcEligibilityParams {
  deltaTarget: { min: number; max: number };
  dteTarget: { min: number; max: number };
  minStrike: number | null; // max(stockPrice, costBasis) from ccStrikeFloor — call must sit at/above this
  oiMin: number;
  /** Reject percent of mid (hybrid rule; $0.05 floor always applies). */
  widthPctMax: number;
  /** Absolute reject ceiling, dollars per share. */
  widthCeiling: number;
}

// Hard gate check for ONE chain leg. Returns false for anything that must
// never be counted as an eligible candidate, full stop — never a
// warning/downgrade. Mirrors requirement #4's exact quote-validity contract:
// a one-sided (bid <= 0 XOR ask <= 0), crossed (ask < bid), missing, or
// non-finite quote can never support a reliable sell premium.
// SCAN-ALIGN-0001C1 -- open interest must be real data: finite and >= 0.
// null/undefined/NaN/Infinity/negative is invalid data (never coerced to 0),
// and would otherwise reach the ranking comparator as NaN. Returns the
// rejection reason code, or null when OI is valid. OI below OI_MIN is NOT
// invalid: it stays eligible and is disclosed by ccLiquidityWarning.
export function ccOpenInterestRejection(openInterest: unknown): 'INSUFFICIENT_DATA' | null {
  return typeof openInterest === 'number' && Number.isFinite(openInterest) && openInterest >= 0
    ? null
    : 'INSUFFICIENT_DATA';
}

// CC-WHEEL-0001: the first rule that removes a leg, in the order the rules are applied. `isEligibleCcLeg` is
// exactly "no rejection", so the exclusion report (ccExclusionFunnel.ts) can never drift from the real gate.
export type CcLegRejection =
  | 'NOT_CALL' | 'NO_DELTA' | 'BAD_STRIKE' | 'BAD_OI' | 'DELTA_WINDOW' | 'BELOW_FLOOR' | 'BAD_QUOTE' | 'CROSSED_QUOTE' | 'WIDTH';

export function ccLegRejection(leg: WheelChainLeg, dte: number, p: CcEligibilityParams): CcLegRejection | null {
  void dte;
  if (leg.optionType !== 'C') return 'NOT_CALL';
  if (leg.delta == null || !Number.isFinite(leg.delta)) return 'NO_DELTA';
  if (!Number.isFinite(leg.strikePrice)) return 'BAD_STRIKE'; // keeps NaN out of the ranking comparator
  if (ccOpenInterestRejection(leg.openInterest) != null) return 'BAD_OI';
  if (!hasOpenInterestMarket(leg.openInterest)) return 'BAD_OI'; // LIQUIDITY-SYNC-0001: zero OI = no market

  // The strike floor is checked BEFORE the delta window, so a leg that fails both is counted as below the floor:
  // the floor is the safety rule, and the exclusion report should show how much of the chain it alone rules out.
  if (p.minStrike != null && leg.strikePrice < p.minStrike) return 'BELOW_FLOOR';

  const absDelta = Math.abs(leg.delta);
  if (absDelta < p.deltaTarget.min || absDelta > p.deltaTarget.max) return 'DELTA_WINDOW';

  // TE-0007C corrective round: strict two-sided, non-crossed, finite quote —
  // replaces the old `bid <= 0 && ask <= 0` check, which accepted a
  // one-sided quote (e.g. bid 0, ask > 0) and computed a midpoint off it.
  if (!Number.isFinite(leg.bid) || !Number.isFinite(leg.ask)) return 'BAD_QUOTE';
  if (!(leg.bid > 0) || !(leg.ask > 0)) return 'BAD_QUOTE';
  if (leg.ask < leg.bid) return 'CROSSED_QUOTE';

  // SCAN-ALIGN-0001C2 -- hybrid width rule + $0.50-style ceiling via the shared function (the
  // same one evaluatePmccQuoteQuality uses for the PMCC short leg). The old fixed dollar cap is gone.
  if (evaluateHybridSpread(leg.bid, leg.ask, { rejectPct: p.widthPctMax, warnPct: CC_WARN_PCT_UNUSED, ceiling: p.widthCeiling }).reject) return 'WIDTH';
  // OI-LIQUIDITY-CHOICE-0001, Phase 2 -- OI *below the minimum* is deliberately NOT a gate: it is disclosed by
  // ccLiquidityWarning at the point a candidate is selected (see buildCcSpreadCandidate).
  return null;
}

function isEligibleCcLeg(leg: WheelChainLeg, dte: number, p: CcEligibilityParams): boolean {
  return ccLegRejection(leg, dte, p) === null;
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
    if (a.dte !== b.dte) return a.dte - b.dte; // 4. earlier expiration wins
    return a.strikePrice - b.strikePrice; // 5. lower strike wins (final deterministic tie-break)
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
  /** CC-WHEEL-0001 S2a: the trader opted in, for this position, to strikes below the cost basis. */
  allowBelowBasis?: boolean;
}

// CC-EARNINGS-SEARCH-0002 (Ian/Paul approved) — earnings safety is now
// checked per-candidate, against THAT candidate's own DTE, not a
// pre-candidate estimate against the rule's DTE_MAX ceiling. The old
// caller-computed `earningsWithinExpiry` boolean hard-blocked the ENTIRE
// search (zero candidates, full stop) whenever earnings fell anywhere
// inside the rule's DTE range — even when a specific, safe expiration
// existed before earnings. Mirrors the pattern already used by CSP/spread
// checklists and the CC checklist's own post-selection re-check.
function isEarningsSafeForExpiration(earningsDate: string | null | undefined, expirationDate: string): boolean {
  return earningsOnOrBeforeExpiration(earningsDate, expirationDate, undefined, EARNINGS_MIN_DAYS_AFTER_EXPIRY) === false;
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
  // OI-LIQUIDITY-CHOICE-0001, Phase 2 -- was a separate, CC-only 2x-floor
  // caution, only ever reachable for candidates that had already survived
  // the (now-removed) hard oiMin exclude. Replaced with the same
  // assessOiLiquidity every other strategy in this app uses -- one
  // consistent voice and threshold for "is this OI thin enough to
  // disclose," not a different rule per strategy without a stated reason.
  // Now correctly reachable for candidates below oiMin too, since those
  // can actually become `best` now that OI no longer hard-excludes them.
  const ccOiAssessment = assessOiLiquidity({
    shortOI: best.openInterest, longOI: best.openInterest, oiMin: params.rules.OI_MIN,
  });
  const ccLiquidityWarning = ccOiAssessment.status === 'warn' ? ccOiAssessment.reason : null;
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

  // Never select ITM, never below cost basis -- enforced by filtering the
  // FULL SEARCH SPACE up front (see selectAllEligibleCcContracts), not by
  // validating a single already-chosen pick after the fact. This is what
  // lets a second, less delta-perfect but fully eligible contract be found
  // when the single delta-closest strike would otherwise fail a liquidity/
  // quote/strike gate and (in the old flow) suppress the whole search.
  const price = params.stockPrice;
  const costBasis = params.capacity.costBasis;
  // CC-WHEEL-0001 S1: the floor needs both the stock price and a known cost basis. Unknown means no
  // candidates (fail closed), never a floor built from whichever number happens to be present.
  const strikeFloor = ccStrikeFloor(price, costBasis, { allowBelowBasis: params.allowBelowBasis });
  if (strikeFloor.floor === null) return null;
  const minStrike = strikeFloor.floor;

  // CC-EARNINGS-SEARCH-0002 — filter by each candidate's OWN dte before
  // selecting the best, not a pre-candidate estimate. selectAllEligibleCc-
  // Contracts already returns results sorted best-first (delta-distance,
  // then OI, then bid/ask width, then earlier expiration), so [0] after
  // filtering is still the correct best-among-earnings-safe pick.
  const eligible = selectAllEligibleCcContracts(chain, {
    deltaTarget: { min: params.rules.DELTA_MIN, max: params.rules.DELTA_MAX },
    dteTarget: { min: params.rules.DTE_MIN, max: params.rules.DTE_MAX },
    minStrike,
    oiMin: params.rules.OI_MIN,
    widthPctMax: params.rules.WIDTH_PCT_MAX,
    widthCeiling: params.rules.WIDTH_CEILING,
  });
  const best = eligible.find(c => isEarningsSafeForExpiration(params.earningsDate, c.expirationDate)) ?? null;
  if (!best) return null;

  return buildCcSpreadCandidate(best, params, price, costBasis);
}

// ── CC-WHEEL-0001 S4: the strike grid ───────────────────────────────────
// Every call in the DTE window that passes the SAFETY gates, laid out by expiration and strike. Preference rules
// (delta range, bid/ask width, open interest) do not remove anything here: they tag a cell (wide, thin OI) or are
// applied by the screen as a highlight. Safety gates that do remove a call, each counted in `left`:
//   in the money (strike below the stock price), no usable two-sided quote, an expiry too close to earnings, and
//   very far out of the money (delta under 0.02), plus a cap on the cell count. A strike below the cost basis stays
//   in, marked `belowFloor`, because hiding it is a screen choice (the switch), not a safety gate.
const GRID_MIN_DELTA = 0.02;
const GRID_MAX_DELTA = 0.70;
const GRID_MAX_CELLS = 400;

export function buildCcGrid(
  chain: { expirations: string[]; chains: Record<string, WheelChainLeg[]> },
  params: CcFindParams,
): CcGrid {
  const price = params.stockPrice;
  const basis = params.capacity.costBasis != null && params.capacity.costBasis > 0 ? params.capacity.costBasis : null;
  const contracts = Math.max(1, params.capacity.availableCoveredContracts);
  const floorInfo = ccStrikeFloor(price, basis);
  const left = { inTheMoney: 0, unusableQuote: 0, earnings: 0, farOtm: 0, truncated: 0 };
  const cells: CcGridCell[] = [];
  const expirations: Array<{ expiration: string; dte: number }> = [];
  // Fail closed like the scan: with no known stock price or cost basis there is no floor, so there is no grid.
  if (floorInfo.floor === null) return { basis, floor: null, stockPrice: price, contracts, expirations, cells, left };

  for (const expDate of chain.expirations) {
    const dte = daysUntil(expDate);
    if (dte < params.rules.DTE_MIN || dte > params.rules.DTE_MAX) continue;
    let any = false;
    for (const leg of chain.chains[expDate] ?? []) {
      if (leg.optionType !== 'C') continue;
      if (leg.delta == null || !Number.isFinite(leg.delta) || !Number.isFinite(leg.strikePrice)) { left.unusableQuote += 1; continue; }
      if (!Number.isFinite(leg.bid) || !Number.isFinite(leg.ask) || !(leg.bid > 0) || !(leg.ask > 0) || leg.ask < leg.bid) { left.unusableQuote += 1; continue; }
      if (price != null && leg.strikePrice < price) { left.inTheMoney += 1; continue; }
      if (!isEarningsSafeForExpiration(params.earningsDate, expDate)) { left.earnings += 1; continue; }
      const delta = Math.abs(leg.delta);
      if (delta < GRID_MIN_DELTA || delta > GRID_MAX_DELTA) { left.farOtm += 1; continue; }
      if (cells.length >= GRID_MAX_CELLS) { left.truncated += 1; continue; }

      const mid = (leg.bid + leg.ask) / 2;
      const premiumPerShare = Math.round(mid * 100) / 100;
      const premiumTotal = Math.round(premiumPerShare * 100 * contracts * 100) / 100;
      const calledAwayTotal = basis === null ? null : Math.round(((leg.strikePrice - basis) * 100 * contracts + premiumTotal) * 100) / 100;
      cells.push({
        expiration: expDate, dte, strike: leg.strikePrice, delta, bid: leg.bid, ask: leg.ask, premiumPerShare,
        openInterest: leg.openInterest, occSymbol: leg.occSymbol,
        belowFloor: floorInfo.floor !== null && leg.strikePrice < floorInfo.floor,
        wide: evaluateHybridSpread(leg.bid, leg.ask, { rejectPct: params.rules.WIDTH_PCT_MAX, warnPct: CC_WARN_PCT_UNUSED, ceiling: params.rules.WIDTH_CEILING }).reject,
        thinOi: !(typeof leg.openInterest === 'number' && leg.openInterest >= params.rules.OI_MIN),
        calledAwayTotal,
        calledAwayPct: calledAwayTotal === null || basis === null ? null : Math.round((calledAwayTotal / (basis * 100 * contracts)) * 10000) / 100,
        premiumTotal,
        notCalledBasis: basis === null ? null : Math.round((basis - premiumPerShare) * 100) / 100,
      });
      any = true;
    }
    if (any) expirations.push({ expiration: expDate, dte });
  }
  cells.sort((a, b) => a.dte - b.dte || a.strike - b.strike);
  return { basis, floor: floorInfo.floor, stockPrice: price, contracts, expirations, cells, left };
}

// ── CC-WHEEL-0001: why did nothing qualify? ─────────────────────────────
// Counts, for one symbol's chain, how many calls each rule removed (the FIRST rule that removed each leg, in the
// order ccLegRejection applies them), using the same gate and the same floor as findBestCoveredCall. Pure.
export interface CcExclusionReport {
  floor: number | null;
  callsTotal: number;
  outsideDte: number;
  inWindow: number;
  rejected: Record<CcLegRejection, number>;
  eligible: number;
  removedByEarnings: number;
  /** Highest |delta| among in-window calls at or above the floor, ignoring the delta window. */
  bestDeltaAtFloor: { delta: number; strike: number; expiration: string } | null;
}

export function diagnoseCcExclusions(
  chain: { expirations: string[]; chains: Record<string, WheelChainLeg[]> },
  params: CcFindParams,
): CcExclusionReport {
  const strikeFloor = ccStrikeFloor(params.stockPrice, params.capacity.costBasis, { allowBelowBasis: params.allowBelowBasis });
  const eligibility: CcEligibilityParams = {
    deltaTarget: { min: params.rules.DELTA_MIN, max: params.rules.DELTA_MAX },
    dteTarget: { min: params.rules.DTE_MIN, max: params.rules.DTE_MAX },
    minStrike: strikeFloor.floor,
    oiMin: params.rules.OI_MIN,
    widthPctMax: params.rules.WIDTH_PCT_MAX,
    widthCeiling: params.rules.WIDTH_CEILING,
  };
  const rejected: Record<CcLegRejection, number> = {
    NOT_CALL: 0, NO_DELTA: 0, BAD_STRIKE: 0, BAD_OI: 0, DELTA_WINDOW: 0, BELOW_FLOOR: 0, BAD_QUOTE: 0, CROSSED_QUOTE: 0, WIDTH: 0,
  };
  let callsTotal = 0;
  let outsideDte = 0;
  let eligible = 0;
  let removedByEarnings = 0;
  let bestDeltaAtFloor: CcExclusionReport['bestDeltaAtFloor'] = null;

  for (const expDate of chain.expirations) {
    const dte = daysUntil(expDate);
    const inDte = dte >= eligibility.dteTarget.min && dte <= eligibility.dteTarget.max;
    for (const leg of chain.chains[expDate] ?? []) {
      if (leg.optionType !== 'C') continue;
      callsTotal += 1;
      if (!inDte) { outsideDte += 1; continue; }
      if (strikeFloor.floor !== null && Number.isFinite(leg.strikePrice) && leg.strikePrice >= strikeFloor.floor
        && leg.delta != null && Number.isFinite(leg.delta)) {
        const d = Math.abs(leg.delta);
        if (!bestDeltaAtFloor || d > bestDeltaAtFloor.delta) bestDeltaAtFloor = { delta: d, strike: leg.strikePrice, expiration: expDate };
      }
      const reason = ccLegRejection(leg, dte, eligibility);
      if (reason) { rejected[reason] += 1; continue; }
      if (isEarningsSafeForExpiration(params.earningsDate, expDate)) eligible += 1; else removedByEarnings += 1;
    }
  }
  return { floor: strikeFloor.floor, callsTotal, outsideDte, inWindow: callsTotal - outsideDte, rejected, eligible, removedByEarnings, bestDeltaAtFloor };
}

/** One readable line: which rule removed how many calls. Plain text for the scan's "why nothing qualified" row. */
export function formatCcExclusionSummary(r: CcExclusionReport, rules: CcRulesType): string {
  if (r.callsTotal === 0) return 'The chain returned no calls.';
  const parts: string[] = [];
  const add = (n: number, label: string) => { if (n > 0) parts.push(`${label} ${n}`); };
  add(r.rejected.BELOW_FLOOR, r.floor !== null ? `strike below $${r.floor.toFixed(2)} floor` : 'strike below floor');
  add(r.rejected.DELTA_WINDOW, `delta outside ${rules.DELTA_MIN}-${rules.DELTA_MAX}`);
  add(r.rejected.BAD_QUOTE + r.rejected.CROSSED_QUOTE, 'no usable quote');
  add(r.rejected.WIDTH, 'bid/ask too wide');
  add(r.rejected.NO_DELTA + r.rejected.BAD_STRIKE + r.rejected.BAD_OI, 'missing data');
  add(r.removedByEarnings, 'earnings too close');
  let line = `${r.callsTotal} calls: ${r.outsideDte} outside DTE ${rules.DTE_MIN}-${rules.DTE_MAX}`;
  line += parts.length ? `; of ${r.inWindow} in range, removed by ${parts.join(', ')}.` : `; ${r.inWindow} in range.`;
  if (r.bestDeltaAtFloor) {
    const b = r.bestDeltaAtFloor;
    line += ` Highest delta at or above the floor: ${b.delta.toFixed(2)} (strike $${b.strike}, ${b.expiration}).`;
  } else if (r.floor !== null) {
    line += ' No call at or above the floor has a delta.';
  }
  return line;
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
// established for CSP. Capacity still short-circuits to zero candidates
// (never search for/return a strike exceeding available coverage).
// Earnings no longer short-circuits the whole search — CC-EARNINGS-
// SEARCH-0002 (Ian/Paul approved) moved it to a per-candidate filter, see
// isEarningsSafeForDte above.
export function findAllCoveredCalls(
  chain: { expirations: string[]; chains: Record<string, WheelChainLeg[]> },
  params: CcFindAllParams,
): { results: CcCandidateResult[] } {
  if (params.capacity.availableCoveredContracts <= 0) return { results: [] };

  const price = params.stockPrice;
  const costBasis = params.capacity.costBasis;
  // CC-WHEEL-0001 S1: same fail-closed floor as findBestCoveredCall.
  const strikeFloor = ccStrikeFloor(price, costBasis, { allowBelowBasis: params.allowBelowBasis });
  if (strikeFloor.floor === null) return { results: [] };
  const minStrike = strikeFloor.floor;

  // CC-EARNINGS-SEARCH-0002 — same per-candidate filter as
  // findBestCoveredCall: a candidate expiring before earnings is excluded
  // individually, not used to blank out every candidate for this symbol.
  const eligible = selectAllEligibleCcContracts(chain, {
    deltaTarget: { min: params.rules.DELTA_MIN, max: params.rules.DELTA_MAX },
    dteTarget: { min: params.rules.DTE_MIN, max: params.rules.DTE_MAX },
    minStrike,
    oiMin: params.rules.OI_MIN,
    widthPctMax: params.rules.WIDTH_PCT_MAX,
    widthCeiling: params.rules.WIDTH_CEILING,
  }).filter(c => isEarningsSafeForExpiration(params.earningsDate, c.expirationDate));

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
