// lib/scans/types.ts
// Mechanically extracted from app/screener/page.tsx (TE-0005A). Verbatim — not rewritten.

export interface CheckResult { status: 'pass' | 'fail' | 'warn' | 'pending'; value: string; reason: string; }


export interface SpreadCandidate {
  strategy: string; expiration: string; dte: number;
  shortStrike: number; longStrike: number; shortDelta: number;
  credit: number; spreadWidth: number; creditRatio: number;
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
  longCost?: number; netDebit?: number; maxProfit?: number; extrinsicCapture?: number;
  longOccSymbolPMCC?: string; shortOccSymbolPMCC?: string;

  // CSP-specific (TE-0007A) — single-leg cash-secured put, no long leg.
  requiredCash?: number;       // strike * 100 * contracts
  annualizedRoc?: number;      // roc * (365 / dte)
  breakeven?: number;          // strike - premium per share
  assignmentPrice?: number;    // price paid per share if assigned (== strike)
  capitalBlocked?: boolean;    // true when requiredCash exceeds available cash
  capitalWarning?: string | null;

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
  symbol: string; strategy: string; price: number | null; ivr: number | null;
  ivx?: number | null; ivx30?: number | null; ivHv30Diff?: number | null; liquidityRating?: number | null;
  qualified: boolean; bestCandidate: SpreadCandidate | null;
  failReasons: string[]; earningsDate?: string | null; trendResult?: TrendResult;
  isEtf?: boolean;
  underlyingType?: 'index' | 'etf' | 'stock';
  ruleSetApplied?: string;
  checks: { ivr: CheckResult; earnings: CheckResult; oi: CheckResult; delta: CheckResult; credit: CheckResult; roc: CheckResult; pop: CheckResult; iv: CheckResult; emClearance: CheckResult; };
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


