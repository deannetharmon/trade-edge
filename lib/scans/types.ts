// lib/scans/types.ts
// Mechanically extracted from app/screener/page.tsx (TE-0005A). Verbatim — not rewritten.

export interface CheckResult { status: 'pass' | 'fail' | 'warn' | 'pending'; value: string; reason: string; }


export interface SpreadCandidate {
  sourceResultId?: string;
  strategy: string; expiration: string; dte: number;
  shortStrike: number; longStrike: number; shortDelta: number;
  credit: number; spreadWidth: number; creditRatio: number;
  capitalRequired?: number;
  theoreticalMaxLoss?: number;
  contractMultiplier?: number;
  quantity?: number;
  roc: number; pop: number | null; shortOI: number; longOI: number; shortIv?: number | null;
  expirationIvx?: number | null; expectedMove?: number | null;
  shortCallStrike?: number; longCallStrike?: number;
  shortCallOI?: number; longCallOI?: number;
  callCredit?: number; callWidth?: number; totalCredit?: number; optimized?: boolean;
  shortOccSymbol?: string; longOccSymbol?: string;
  shortCallOccSymbol?: string; longCallOccSymbol?: string;
  
  shortBid?: number;
  shortAsk?: number;
  longBid?: number;
  longAsk?: number;
  quoteFetchedAt?: number;
  
  // PMCC-specific
  longExpiration?: string; longDte?: number; longDelta?: number;
  longCost?: number; netDebit?: number; netDebitUnit?: 'per_share'; maxProfit?: number; extrinsicCapture?: number;
  longOccSymbolPMCC?: string; shortOccSymbolPMCC?: string;

  // CSP-specific (TE-0007A) — single-leg cash-secured put, no long leg.
  requiredCash?: number;       // strike * 100 * contracts
  annualizedRoc?: number;      // roc * (365 / dte)
  breakeven?: number;          // strike - premium per share
  assignmentPrice?: number;    // price paid per share if assigned (== strike)
  capitalBlocked?: boolean;    // true when requiredCash exceeds available cash
  capitalWarning?: string | null;
  // CSP-0002 corrective pass — the exact midpoint csp-finder.ts used to
  // compute credit/breakeven/ROC (either the chain's supplied mid, when it
  // falls within [bid, ask], or the canonical (bid+ask)/2 otherwise — see
  // cspSearch.ts's deriveUsableMid). Presentation code should display this
  // rather than recomputing (bid+ask)/2 itself, to guarantee the "Mid"
  // shown on a card always matches the mid actually used in the math.
  cspMid?: number;

  // CSP-0002 — exhaustive-search diagnostics, carried onto the candidate so a
  // structurally discovered but liquidity-disqualified put is never silently
  // dropped. cspCandidateStatus is null only when no candidate at all could
  // be structurally discovered (see lib/scans/cspSearch.ts).
  cspCandidateStatus?: import('./cspSearch').CspCandidateStatus | null;
  cspBidAskWidth?: number;      // ask - bid, dollars
  cspBidAskWidthPct?: number;   // width as % of midpoint
  cspOiPassing?: boolean;       // openInterest >= OI_MIN
  cspBidAskPassing?: boolean;   // bidAskWidth <= BID_ASK_MAX -- the only CSP liquidity dimension that disqualifies
  /** Truthful, value-bearing PRIMARY disqualification reason — populated
   * only when the candidate fails to qualify (i.e. bid/ask width exceeds the
   * configured maximum). Low OI alone never populates this field: per
   * product policy it is a warning, not a disqualifier (see cspOiWarning). */
  cspLiquidityReason?: string | null;
  /** Independent, non-blocking warning shown whenever OI is below OI_MIN,
   * regardless of whether the candidate otherwise qualifies. */
  cspOiWarning?: string | null;
  cspSearchDiagnostics?: import('./cspSearch').CspSearchDiagnostics;

  // CSP-WORKFLOW-0001 — canonical multi-candidate identity + independent
  // market-qualification / account-eligibility state (see
  // docs/reviews/FIND-CSP-Comprehensive-Code-Audit.md §22-§23 and
  // lib/scans/candidateIdentity.ts / lib/scans/cspQualification.ts).
  /** Stable identity for this exact contract — OCC symbol when valid, else
   * a validated strategy+underlying+expiration+type+strike composite. Must
   * be used for React keys, Best Opportunities joins, CSV rows, and cache
   * lookups instead of symbol/symbol+strategy. */
  candidateId?: string;
  cspLiquidityClass?: import('./cspQualification').CspLiquidityClass;
  /** Independent of account eligibility — a market-qualified contract can
   * still be account-ineligible (unaffordable/unverified) and must remain
   * visible either way; see cspAccountEligibility. */
  cspMarketQualification?: import('./cspQualification').CspMarketQualification;
  /** Independent of market qualification — never used to alter the
   * market-quality score. CAPITAL_UNVERIFIED is distinct from
   * INSUFFICIENT_CAPITAL and must never be treated as unlimited capital. */
  cspAccountEligibility?: import('./cspQualification').CspAccountEligibility;
  /** Qualification imposed by the confirmed scan mode, independent of
   * market structure and account eligibility. */
  cspModeQualification?: import('./cspQualification').CspModeQualification;
  cspModeQualificationReasons?: string[];
  /** Non-disqualifying warnings (low OI, borderline liquidity, etc.) —
   * separate from the single primary disqualification reason in
   * cspLiquidityReason. */
  cspAdvisoryWarnings?: string[];
  /** min(broker-reported option buying power, broker-reported cash balance)
   * for the selected account, or null when unverified. Never a fallback
   * constant. */
  cspAvailableCapital?: number | null;
  /** CSP-specific score (lib/scans/cspScore.ts) — independent of account
   * eligibility; never influenced by capital state. Undefined until IVR/
   * technical/earnings inputs are threaded through by the caller (see
   * app/screener/page.tsx's runCspChecklist). */
  cspScore?: import('./cspScore').CspScoreResult;

  // CC-specific (TE-0007C) — covered call written against owned shares.
  // shortStrike/shortDelta/shortOI/shortBid/shortAsk/roc/annualizedRoc/credit
  // are reused from the shared fields above (see covered-call-finder.ts for
  // exactly what each holds in the CC case); these ccXxx fields carry the
  // capacity/cost-basis/warning data that has no existing shared home.
  ccSharesOwned?: number;
  ccGrossCoveredContracts?: number;
  ccExistingShortCallContracts?: number;
  ccWorkingShortCallContracts?: number;
  ccAvailableCoveredContracts?: number;
  ccCostBasis?: number | null;
  ccPremiumPerShare?: number;
  ccPremiumPerContract?: number;
  ccPeriodYieldOnShares?: number | null;
  ccAnnualizedYieldOnShares?: number | null;
  ccStrikeVsStockPct?: number | null;
  ccStrikeVsCostBasisPct?: number | null;
  ccMaxUpsideIfCalledAway?: number | null;
  ccAssignmentProceeds?: number;
  ccBidAskWidth?: number;
  ccLiquidityWarning?: string | null;
  ccAssignmentWarning?: string | null;
  // TE-0007C final corrective pass — mirrors CoveredCallCapacity.
  // hasUnclassifiedExposure: true when some (attributable) option exposure
  // for this symbol could not be classified call/put and was conservatively
  // reserved as a call. The candidate is still valid/usable — this is a
  // disclosure flag, not a rejection — but capacity display must not claim
  // to be fully verified when this is true.
  ccHasUnclassifiedExposure?: boolean;
}


export interface TrendResult {
  trend: 'uptrend' | 'downtrend' | 'sideways' | 'unknown';
  strategy: 'BPS' | 'BCS' | 'IC' | 'NO_TRADE';
  subtype: 'CONTINUATION' | 'REVERSAL' | 'RANGE' | 'CHOP' | 'UNKNOWN';
  confidence: number; // 0-100
  ma20: number;
  ma50: number;
  ma200?: number;
  reason: string;
  scores?: {
    momentum: number;
    maAlignment: number;
    slope: number;
    structure: number;
    chop: number;
    volatility: number;
    total: number;
  };
  metrics?: {
    price: number;
    ma20: number;
    ma50: number;
    ma200: number;
    momentum20: number;
    momentum60: number;
    momentum90: number;
    rsi14: number;
    ma20Slope: number;
    ma50Slope: number;
    range60: number;
    chopRatio: number;
    distFromMa50: number;
    higherHighs: boolean;
    higherLows: boolean;
    lowerHighs: boolean;
    lowerLows: boolean;
  };
}


export interface ScreenResult {
  sourceResultId?: string;
  symbol: string; strategy: string; price: number | null; ivr: number | null;
  ivx?: number | null; ivx30?: number | null; ivHv30Diff?: number | null; liquidityRating?: number | null;
  qualified: boolean; bestCandidate: SpreadCandidate | null;
  failReasons: string[]; earningsDate?: string | null; trendResult?: TrendResult;
  isEtf?: boolean;
  underlyingType?: 'index' | 'etf' | 'stock';
  ruleSetApplied?: string;
  publishedOrder?: number;
  publishedRank?: number;
  checks: { ivr: CheckResult; earnings: CheckResult; oi: CheckResult; delta: CheckResult; credit: CheckResult; roc: CheckResult; pop: CheckResult; iv: CheckResult; emClearance: CheckResult; };
  // CSP-WORKFLOW-0001 — one ScreenResult now represents exactly ONE
  // contract for multi-candidate strategies (CSP today). `candidateId`
  // mirrors `bestCandidate.candidateId` at the top level so React keys,
  // Best Opportunities joins, CSV rows, and cache lookups never need to
  // drill into bestCandidate (which is nullable) to find a stable identity.
  // Undefined for strategies not yet migrated to per-contract results.
  // PMCC and CSP use it to preserve every retained contract/pair identity.
  candidateId?: string;
  /** Canonical PMCC pair. When present, PMCC presentation and audit logic
   * must use this structure rather than re-deriving diagonal semantics from
   * the legacy spread-shaped bestCandidate compatibility adapter. */
  pmccPair?: import('./pmccTypes').PmccPairResult;
  /** Canonical, versioned PMCC qualification/readiness/action decision. */
  pmccDecision?: import('./pmccTypes').PmccDecision;
  pmccPairingCounts?: import('./pmccTypes').PmccPairingCounts;
  pmccIncompleteAnalysis?: boolean;
  pmccLegRejections?: import('./pmccTypes').PmccLegRejection[];
  pmccAsOf?: string;
  pmccAuditKind?: 'MARKET_DATA_FAILURE' | 'CHAIN_ADAPTATION_FAILURE' | 'PAIRING_ENGINE_FAILURE';
}


export interface RankConfig {
  weightMomentum: number;     // 0–25
  weightIvr: number;          // 0–15
  weightEmClearance: number;  // 0–15
  weightRange: number;        // 0–15
  weightTechnical: number;    // 0–10
  weightLiquidity: number;    // 0–10
  weightBuffer: number;       // 0–10
  dteSweetSpot: number;
  dteRange: number;
  thresholdGreen: number;
  thresholdYellow: number;
  thresholdOrange: number;
  weightCredit: number; weightRoc: number; weightPop: number; weightDte: number;
}


export interface DimensionScore {
  momentum: number; ivr: number; emClearance: number; range: number; technical: number; liquidity: number; buffer: number; total: number;
}


export interface RawScanEntry {
  symbol: string;
  strategy: 'BPS' | 'BCS' | 'IC';
  metrics: { symbol: string; ivRank: number | null; earningsExpectedDate: string | null };
  chainData: { expirations: string[]; chains: Record<string, any[]>; isEtfOrIndex: boolean };
  price: number | null;
  trendResult?: TrendResult;
}
