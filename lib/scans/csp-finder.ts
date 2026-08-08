// lib/scans/csp-finder.ts
// TE-0007A — CSP as a first-class Screener strategy.
// CSP-0002 — replaced the "select one, then reject" delegation to Wheel's
// findBestWheelContract with an exhaustive, liquidity-aware search
// (lib/scans/cspSearch.ts). See that module's header for the full root-cause
// writeup and the search/selection policy. Wheel's own findBestWheelContract
// is untouched and still serves the Wheel page and the Covered Call finder —
// see docs/reviews/CSP-0002-Implementation-Report.md "Wheel compatibility"
// for the audit proving this.
//
// CSP-WORKFLOW-0001 — cspSearch.ts now returns EVERY structurally valid
// candidate, not just one. This module's job changes accordingly: instead of
// mapping the single selected candidate into one SpreadCandidate/qualified
// boolean, findAllCsp() maps EVERY discovered candidate into its own
// SpreadCandidate, each independently carrying its own market-qualification
// state, advisory warnings, and account-eligibility state (which are
// deliberately independent of each other — see
// docs/reviews/FIND-CSP-Comprehensive-Code-Audit.md §23). findBestCsp() is
// kept as a deprecated, backward-compatible wrapper around findAllCsp() for
// any caller not yet migrated to the multi-candidate path.
import { searchCspCandidates, describeCspSearchOutcome, type CspSearchRules, type CspSearchResult, type CspRawCandidate } from './cspSearch';
import { classifyAccountEligibility, isMarketQualified, type CspAccountEligibility, type CspMarketQualification, type CspLiquidityClass } from './cspQualification';
import type { SpreadCandidate } from './types';
import type { CspRulesType } from './constants';
import type { EligibilityDecision } from '@/lib/decision/types';

export interface CspFindParams {
  rules: CspRulesType;
  contracts?: number;          // default 1 — sizing happens at trade time, not scan time
  /** @deprecated use `capital` — kept for any caller not yet migrated.
   * null/undefined = unknown; capital will be reported CAPITAL_UNVERIFIED,
   * never treated as unlimited. */
  availableCash?: number | null;
  /** CSP-WORKFLOW-0001 — preferred capital input. CSP available capital is
   * min(optionBuyingPower, cashBalance) for the SELECTED account only. Any
   * missing/non-finite/negative value, or no account selected, produces
   * CAPITAL_UNVERIFIED — never unlimited-capital (fail-open) behavior. */
  capital?: {
    accountSelected: boolean;
    accountId?: string | null;
    optionBuyingPower?: number | null;
    cashBalance?: number | null;
    strategyNotPermitted?: boolean;
  };
  /** Needed to build each candidate's stable identity (composite fallback). */
  underlyingSymbol?: string;
  /** Symbol-level market-qualification gates, evaluated once per symbol and
   * applied uniformly to every candidate discovered for that symbol — see
   * the ticket's "Discovery before classification" requirement: IVR/
   * earnings no longer prevent discovery, they classify what was
   * discovered. */
  ivrMarketDisqualified?: boolean;
  earningsMarketDisqualified?: boolean;
  /** CSP-WORKFLOW-RECONCILE-0002 — SQ-0001A foundation eligibility for this
   * underlying/horizon (from evaluateUnderlyingFoundation's CSP thesis +
   * evaluateStrategyEligibility, computed once per symbol upstream and
   * applied uniformly to every candidate — same pattern as
   * ivrMarketDisqualified/earningsMarketDisqualified above). This is the
   * foundation gate: it can block CSP on bearish/chaotic underlying
   * evidence before any contract is ranked, and that block cannot be
   * overridden by a candidate's premium/ROC/score, since those are computed
   * entirely downstream of marketQualification.
   *
   * null/undefined = foundation evidence was not evaluated for this call —
   * NOT treated as passing, simply not gated at this call site. Every
   * existing caller that hasn't wired this in yet keeps its current
   * behavior unchanged. */
  foundationEligibility?: EligibilityDecision | null;
}

// One discovered CSP contract, independently qualified/eligible/scored.
export interface CspCandidateResult {
  candidateId: string;
  candidate: SpreadCandidate;
  marketQualification: CspMarketQualification;
  accountEligibility: CspAccountEligibility;
  advisoryWarnings: string[];
  liquidityClass: CspLiquidityClass;
  /** True only when both market-qualified (no warning) AND account-eligible
   * — the Best-Opportunities-eligible / "account-actionable" boundary. */
  accountActionable: boolean;
}

export interface CspFindAllResult {
  /** CSP-WORKFLOW-0001 (BLOCKER-01 fix) — one entry per structurally
   * discovered candidate. Never reduced to "the best one" — every entry
   * must be recorded, scored, and presented independently. */
  results: CspCandidateResult[];
  diagnostics: CspSearchResult['diagnostics'];
  reason: CspSearchResult['reason'];
  /** Populated only when `results` is empty — a truthful, value-bearing
   * explanation of why no structurally valid candidate exists at all. */
  disqualificationReason: string | null;
}

function computeAvailableCspCapital(capital: CspFindParams['capital']): number | null {
  if (!capital) return null;
  const bp = capital.optionBuyingPower;
  const cash = capital.cashBalance;
  const bpOk = typeof bp === 'number' && Number.isFinite(bp) && bp >= 0;
  const cashOk = typeof cash === 'number' && Number.isFinite(cash) && cash >= 0;
  if (!bpOk || !cashOk) return null;
  return Math.min(bp as number, cash as number);
}

function buildAdvisoryWarnings(c: CspRawCandidate, oiMin: number): string[] {
  const warnings: string[] = [];
  if (!c.oiPassing) {
    warnings.push(`OI ${c.openInterest} is below the preferred minimum of ${oiMin}.`);
  }
  if (c.liquidityClass === 'BORDERLINE') {
    warnings.push(`Bid/ask width $${c.bidAskWidth.toFixed(2)} (${c.bidAskWidthPct.toFixed(1)}% of mid) is borderline — excluded from Best Opportunities by default.`);
  }
  return warnings;
}

function marketQualificationFor(
  c: CspRawCandidate,
  params: Pick<CspFindParams, 'ivrMarketDisqualified' | 'earningsMarketDisqualified' | 'foundationEligibility'>,
): CspMarketQualification {
  // SQ-0001A foundation gate is checked first — it is the most fundamental,
  // strategy-agnostic evidence (does the underlying's directional/regime
  // evidence, or a known binary event in the horizon, threaten the CSP
  // thesis at all), evaluated before any CSP-specific liquidity/IVR/
  // earnings classification. Only an explicitly-supplied decision can gate
  // here; a candidate with no foundation evidence at all falls through to
  // the existing CSP-specific checks unchanged.
  const foundation = params.foundationEligibility;
  if (foundation) {
    if (foundation.status === 'INSUFFICIENT_EVIDENCE') return 'DISQUALIFIED_FOUNDATION_INSUFFICIENT_EVIDENCE';
    if (foundation.status === 'INELIGIBLE') return 'DISQUALIFIED_FOUNDATION_INELIGIBLE';
  }
  // Earnings checked before IVR — an earnings-within-window disqualification
  // is a harder, more specific reason than a generic IVR-band miss.
  if (params.earningsMarketDisqualified) return 'DISQUALIFIED_EARNINGS';
  if (params.ivrMarketDisqualified) return 'DISQUALIFIED_IVR';
  if (c.liquidityClass === 'POOR') return 'DISQUALIFIED_POOR_LIQUIDITY';
  if (c.liquidityClass === 'BORDERLINE') return 'QUALIFIED_WITH_LIQUIDITY_WARNING';
  return 'QUALIFIED';
}

function buildSpreadCandidate(
  c: CspRawCandidate,
  contracts: number,
  requiredCash: number,
  availableCspCapital: number | null,
  accountEligibility: CspAccountEligibility,
  marketQualification: CspMarketQualification,
  advisoryWarnings: string[],
  search: CspSearchResult,
  searchRules: CspSearchRules,
): SpreadCandidate {
  const premiumPerContract = parseFloat((c.mid * 100).toFixed(2));
  const totalPremium = parseFloat((premiumPerContract * contracts).toFixed(2));
  const roc = requiredCash > 0 ? (totalPremium / requiredCash) * 100 : 0;
  const annualizedRoc = c.dte > 0 ? roc * (365 / c.dte) : 0;
  const breakeven = parseFloat((c.strikePrice - c.mid).toFixed(2));
  const capitalBlocked = accountEligibility === 'INSUFFICIENT_CAPITAL';
  const capitalWarning = accountEligibility === 'INSUFFICIENT_CAPITAL'
    ? `Insufficient cash — requires $${requiredCash.toLocaleString()}, $${Math.max(0, availableCspCapital ?? 0).toLocaleString()} available. Margin is not used by default.`
    : accountEligibility === 'CAPITAL_UNVERIFIED'
      ? 'Capital could not be verified for the selected account.'
      : null;

  const liquidityReason = c.liquidityClass === 'POOR'
    ? `Bid/ask width $${c.bidAskWidth.toFixed(2)} (${c.bidAskWidthPct.toFixed(1)}% of mid) exceeds the poor-liquidity threshold.`
    : null;
  const oiWarning = c.oiPassing ? null : `OI ${c.openInterest} is below the preferred minimum of ${searchRules.oiMin}.`;

  return {
    strategy: 'CSP',
    expiration: c.expirationDate,
    dte: c.dte,
    shortStrike: c.strikePrice,
    longStrike: c.strikePrice, // no long leg — kept equal to short so shared math (e.g. width = 0) stays sane
    shortDelta: c.delta,
    credit: totalPremium,
    spreadWidth: 0,
    creditRatio: requiredCash > 0 ? totalPremium / requiredCash : 0,
    roc,
    pop: (1 - c.delta) * 100,
    shortOI: c.openInterest,
    longOI: c.openInterest,
    shortOccSymbol: c.occSymbol,
    longOccSymbol: undefined, // deliberately unset — disables the Trade/OTOCO path (hasOccSymbols check), no live execution for CSP yet
    shortBid: c.bid,
    shortAsk: c.ask,
    cspMid: c.mid,
    optimized: true,
    requiredCash,
    annualizedRoc,
    breakeven,
    assignmentPrice: c.strikePrice,
    capitalBlocked,
    capitalWarning,
    cspCandidateStatus: c.status,
    cspBidAskWidth: c.bidAskWidth,
    cspBidAskWidthPct: c.bidAskWidthPct,
    cspOiPassing: c.oiPassing,
    cspBidAskPassing: c.bidAskPassing,
    cspLiquidityReason: liquidityReason,
    cspOiWarning: oiWarning,
    cspSearchDiagnostics: search.diagnostics,
    // CSP-WORKFLOW-0001 additions
    candidateId: c.candidateId,
    cspLiquidityClass: c.liquidityClass,
    cspMarketQualification: marketQualification,
    cspAccountEligibility: accountEligibility,
    cspAdvisoryWarnings: advisoryWarnings,
    cspAvailableCapital: availableCspCapital,
  };
}

// CSP-WORKFLOW-0001 (BLOCKER-01 fix) — the canonical multi-candidate entry
// point. Returns one CspCandidateResult per structurally discovered
// candidate; nothing is reduced to "the best one" here. Capital is
// evaluated independently for EVERY candidate (not only a preselected one —
// closing BLOCKER-03), and market qualification never depends on account
// state (closing the qualified/eligible conflation documented in the
// audit's §23).
export function findAllCsp(
  chain: { expirations: string[]; chains: Record<string, any[]> },
  price: number | null,
  params: CspFindParams,
): CspFindAllResult {
  const contracts = params.contracts ?? 1;
  const searchRules: CspSearchRules = {
    deltaMin: params.rules.DELTA_MIN, deltaMax: params.rules.DELTA_MAX,
    dteMin: params.rules.DTE_MIN, dteMax: params.rules.DTE_MAX,
    oiMin: params.rules.OI_MIN, bidAskMax: params.rules.BID_ASK_MAX,
  };

  const search = searchCspCandidates(chain, searchRules, params.underlyingSymbol ?? '');

  if (search.candidates.length === 0) {
    return {
      results: [],
      diagnostics: search.diagnostics,
      reason: search.reason,
      disqualificationReason: describeCspSearchOutcome(search, searchRules),
    };
  }

  // Legacy single-value capital input (availableCash) is treated as an
  // already-resolved "available CSP capital" figure for backward
  // compatibility; the preferred path is `capital`
  // (min(optionBuyingPower, cashBalance) computed here).
  const availableCspCapital = params.capital
    ? computeAvailableCspCapital(params.capital)
    : (params.availableCash ?? null);
  const accountSelected = params.capital ? params.capital.accountSelected : true; // legacy callers implicitly "selected"

  const results: CspCandidateResult[] = search.candidates.map((c) => {
    const requiredCash = c.strikePrice * 100 * contracts;
    const accountEligibility = classifyAccountEligibility({
      requiredCash,
      availableCspCapital,
      accountSelected,
      strategyNotPermitted: params.capital?.strategyNotPermitted,
    });
    const marketQualification = marketQualificationFor(c, params);
    const advisoryWarnings = buildAdvisoryWarnings(c, searchRules.oiMin);
    const candidate = buildSpreadCandidate(
      c, contracts, requiredCash, availableCspCapital, accountEligibility,
      marketQualification, advisoryWarnings, search, searchRules,
    );
    return {
      candidateId: c.candidateId,
      candidate,
      marketQualification,
      accountEligibility,
      advisoryWarnings,
      liquidityClass: c.liquidityClass,
      accountActionable: isMarketQualified(marketQualification) && marketQualification === 'QUALIFIED' && accountEligibility === 'ELIGIBLE',
    };
  });

  return { results, diagnostics: search.diagnostics, reason: null, disqualificationReason: null };
}

// ── Deprecated single-candidate compatibility wrapper ───────────────────────
// The full outcome of a CSP search: either a genuinely qualified candidate, a
// structurally discovered but liquidity-disqualified candidate (preserved
// for audit display, never hidden), or a true "nothing exists" outcome with
// a specific, truthful reason.
export interface CspFindResult {
  candidate: SpreadCandidate | null;
  qualified: boolean;
  disqualificationReason: string | null;
  search: CspSearchResult;
}

/** @deprecated use findAllCsp() — this wrapper exists only for callers not
 * yet migrated to the multi-candidate path, and silently discards every
 * candidate but the best-ranked one. New code must not call this. */
export function findBestCsp(
  chain: { expirations: string[]; chains: Record<string, any[]> },
  price: number | null,
  params: CspFindParams,
): CspFindResult {
  const all = findAllCsp(chain, price, params);
  const searchRules: CspSearchRules = {
    deltaMin: params.rules.DELTA_MIN, deltaMax: params.rules.DELTA_MAX,
    dteMin: params.rules.DTE_MIN, dteMax: params.rules.DTE_MAX,
    oiMin: params.rules.OI_MIN, bidAskMax: params.rules.BID_ASK_MAX,
  };
  const search = searchCspCandidates(chain, searchRules, params.underlyingSymbol ?? '');

  if (all.results.length === 0) {
    return { candidate: null, qualified: false, disqualificationReason: all.disqualificationReason, search };
  }
  const best = all.results[0];
  // Legacy boolean semantics predate the three-state market-qualification
  // model: QUALIFIED and QUALIFIED_WITH_LIQUIDITY_WARNING (the old
  // QUALIFIED_LOW_OI-equivalent tier) both counted as "qualified" — only a
  // hard market disqualification or a capital block made `qualified` false.
  const marketOk = isMarketQualified(best.marketQualification);
  const qualified = marketOk && best.accountEligibility !== 'INSUFFICIENT_CAPITAL';
  return {
    candidate: best.candidate,
    qualified,
    disqualificationReason: !marketOk
      ? (best.candidate.cspLiquidityReason ?? null)
      : (best.accountEligibility === 'INSUFFICIENT_CAPITAL' ? best.candidate.capitalWarning ?? null : null),
    search,
  };
}
