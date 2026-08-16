import type { PmccDteRanges } from './pmccDteRanges';

export interface PmccDeltaRange {
  min: number;
  max: number;
}

export interface PmccQuotePolicy {
  acceptableSpreadPctMax: number;
  qualifyingSpreadPctMax: number;
  readyQuoteAgeSecondsMax: number;
}

export interface PmccPairingLimits {
  maxCombinationsEvaluated: number;
  maxQualifiedPairsRetained: number;
  maxNearMissPairsRetained: number;
}

export type PmccMarketSession = 'open' | 'closed' | 'pre_market' | 'after_hours' | 'unknown';
export type PmccLegRole = 'long' | 'short';

export interface PmccChainLeg {
  underlyingSymbol: string;
  optionType: 'C' | 'P' | null;
  expiration: string;
  strike: number;
  delta: number | null;
  openInterest: number | null;
  bid: number | null;
  ask: number | null;
  occSymbol: string | null;
  quoteTimestamp: string | number | Date | null;
  delayed: boolean | null;
}

export type PmccQuoteStatus =
  | 'acceptable'
  | 'wide_warning'
  | 'too_wide'
  | 'stale'
  | 'delayed'
  | 'market_closed'
  | 'timestamp_missing'
  | 'insufficient';

export interface PmccQuoteQuality {
  bid: number | null;
  ask: number | null;
  midpoint: number | null;
  width: number | null;
  spreadPct: number | null;
  quoteTimestamp: string | null;
  ageSeconds: number | null;
  delayed: boolean | null;
  structurallyUsable: boolean;
  withinQualifyingWidth: boolean;
  readyInput: boolean;
  status: PmccQuoteStatus;
  reason: string;
}

export interface PmccPairingCriteria {
  dte: PmccDteRanges;
  longDelta: PmccDeltaRange;
  shortDelta: PmccDeltaRange;
  longOiMin: number;
  shortOiMin: number;
  requireDebitBelowWidth: boolean;
  quotePolicy: PmccQuotePolicy;
  limits: PmccPairingLimits;
}

export interface PmccScanSnapshot {
  asOf: string;
  marketSession: PmccMarketSession;
  criteria: PmccPairingCriteria;
}

export type PmccFailureCode =
  | 'INVALID_OPTION_TYPE'
  | 'UNDERLYING_MISMATCH'
  | 'INVALID_OCC_IDENTITY'
  | 'DUPLICATE_CONTRACT'
  | 'DELTA_OUT_OF_RANGE'
  | 'DTE_OUT_OF_RANGE'
  | 'OPEN_INTEREST_BELOW_MINIMUM'
  | 'INVALID_QUOTE'
  | 'BID_ASK_TOO_WIDE'
  | 'LONG_NOT_ITM'
  | 'SHORT_NOT_OTM'
  | 'LONG_EXPIRATION_NOT_LATER'
  | 'LONG_STRIKE_NOT_BELOW_SHORT'
  | 'NET_DEBIT_NOT_POSITIVE'
  | 'NET_DEBIT_NOT_BELOW_WIDTH'
  | 'INVALID_EXTRINSIC'
  | 'INSUFFICIENT_DATA';

export interface PmccFailureReason {
  code: PmccFailureCode;
  message: string;
}

export interface PmccLegRejection {
  role: PmccLegRole;
  occSymbol: string | null;
  strike: number;
  expiration: string;
  reasons: PmccFailureReason[];
}

export interface PmccEligibleLeg {
  candidateId: string;
  role: PmccLegRole;
  underlyingSymbol: string;
  expiration: string;
  dte: number;
  strike: number;
  delta: number;
  openInterest: number;
  occSymbol: string;
  quote: PmccQuoteQuality;
  executablePrice: number;
  intrinsic: number | null;
  extrinsic: number | null;
}

export interface PmccPairMetrics {
  netDebitPerShare: number;
  strikeWidth: number;
  widthMinusDebitPerShare: number;
  widthMinusDebitPctOfDebit: number;
  longIntrinsicPerShare: number;
  longExtrinsicPerShare: number;
  shortCreditToNetDebitPct: number;
  shortCreditToLongExtrinsicPct: number | null;
  netDelta: number;
}

export interface PmccPairResult {
  pairId: string;
  symbol: string;
  longLeg: PmccEligibleLeg;
  shortLeg: PmccEligibleLeg;
  metrics: PmccPairMetrics | null;
  qualified: boolean;
  insufficientData: boolean;
  failureReasons: PmccFailureReason[];
  primaryFailureReason: PmccFailureReason | null;
  orderingLabel: 'Contract order';
}

export interface PmccPairingCounts {
  eligibleLongLegs: number;
  eligibleShortLegs: number;
  potentialCombinations: number;
  combinationsEvaluated: number;
  combinationsOmittedBySafetyLimit: number;
  structurallyValidPairs: number;
  qualifiedPairsBeforeRetention: number;
  nearMissPairsBeforeRetention: number;
  qualifiedPairsRetained: number;
  nearMissPairsRetained: number;
  qualifiedPairsOmittedByRetention: number;
  nearMissPairsOmittedByRetention: number;
}

export interface PmccSessionResult {
  symbol: string;
  asOf: string;
  marketSession: PmccMarketSession;
  criteria: PmccPairingCriteria;
  qualifiedPairs: PmccPairResult[];
  nearMissPairs: PmccPairResult[];
  legRejections: PmccLegRejection[];
  counts: PmccPairingCounts;
  incompleteAnalysis: boolean;
  orderingLabel: 'Contract order';
}

// PMCC on-demand pair lookup ticket. Confirmed via direct read: a
// PmccSessionResult only retains its top maxQualifiedPairsRetained /
// maxNearMissPairsRetained pairs after sorting by the interim neutral
// "Contract order" (ticker -> long expiration -> short expiration -> long
// strike -> short strike). Everything evaluated beyond that retention
// limit is discarded -- only aggregate counts (qualifiedPairsOmittedByRetention
// etc.) survive, not the individual pairs. That means a real, valid,
// qualified structure a person is comparing against their own manually-
// built broker trade can be entirely invisible in the retained set, with
// no way to tell "was this genuinely disqualified" from "was this just
// truncated by the retention limit" -- exactly what caused today's
// frustration comparing against a real TastyTrade example.
//
// Three distinct outcomes a caller needs to be able to tell apart:
export type PmccOnDemandOutcome =
  | 'not_found_in_chain'   // the requested strike/expiration doesn't exist
                            // in the fetched chain at all -- never evaluated
  | 'leg_rejected'          // the specific long or short leg failed its own
                            // eligibility gate (delta/DTE/OI/quote/etc.)
  | 'pair_rejected'         // both legs individually eligible, but the pair
                            // itself failed structural validation
  | 'qualified'             // fully valid -- would be in qualifiedPairs if
                            // there had been room within the retention limit
  | 'near_miss';            // structurally valid but not qualified -- would
                            // be in nearMissPairs if there had been room

export interface PmccOnDemandResult {
  outcome: PmccOnDemandOutcome;
  pair: PmccPairResult | null;
  longLegRejection: PmccLegRejection | null;
  shortLegRejection: PmccLegRejection | null;
  chainMissing: { long: boolean; short: boolean };
}

