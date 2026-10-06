// lib/discovery/leaps/reasons.ts

// LEAPS-QV-0001 Gate 4b -- deterministic reason codes (spec Section 5.4). Each reason carries a fixed template, the
// observed value and the limit from the same comparison that produced it, so wording cannot diverge from logic.

export const LEAPS_RESULT_REASON_CODES = [
  'LEAPS_NOT_EVALUATED_UNDERLYING_NOT_QUALIFIED',
  'LEAPS_NOT_EVALUATED_RUN_CAP',
  'LEAPS_UNDERLYING_QUOTE_UNAVAILABLE',
  'LEAPS_CHAIN_PROVIDER_FAILURE',
  'LEAPS_AUTH_EXPIRED',
  'LEAPS_ACQUISITION_RESTRICTED',
  'LEAPS_ACQUISITION_INCOMPLETE_QUOTE_LIMIT',
  'LEAPS_RANKING_IS_EVALUATED_SUBSET',
  'LEAPS_NO_LEAPS_EXPIRATIONS',
  'LEAPS_NO_CONTRACTS_IN_WINDOW',
  'LEAPS_ALL_CONTRACTS_DATA_UNAVAILABLE',
  'LEAPS_ALL_QUOTES_UNAVAILABLE',
  'LEAPS_NO_SUITABLE_CONTRACT',
  'LEAPS_NO_ELIGIBLE_IN_SUBSET',
  'LEAPS_GATE_FAILURE_COUNT',
] as const;

export const LEAPS_CONTRACT_REASON_CODES = [
  'CONTRACT_DTE_BELOW_MIN',
  'CONTRACT_DTE_ABOVE_MAX',
  'CONTRACT_DELTA_BELOW_MIN',
  'CONTRACT_DELTA_ABOVE_MAX',
  'CONTRACT_OI_BELOW_MIN',
  'CONTRACT_SPREAD_ABOVE_MAX',
  'CONTRACT_EXTRINSIC_ABOVE_MAX',
  'CONTRACT_NON_STANDARD_DELIVERABLE',
  'INSTRUMENT_METADATA_UNAVAILABLE',
  'CONTRACT_CROSSED_MARKET',
  'CONTRACT_QUOTE_ROW_MISSING',
  'CONTRACT_QUOTE_STALE',
  'CONTRACT_QUOTE_NOT_TWO_SIDED',
  'CONTRACT_QUOTE_TIMESTAMP_MISSING',
  'QUOTE_TIMESTAMP_UNPARSEABLE',
  'QUOTE_TIMESTAMP_IN_FUTURE',
  'CONTRACT_QUOTE_SKEW_EXCEEDED',
  'CONTRACT_LAST_SESSION_QUOTE',
  'CONTRACT_METRIC_UNAVAILABLE',
  'CONTRACT_METRIC_INVALID',
  'INCOMPLETE_OPTIONAL_METRICS',
  'CHAIN_DUPLICATE_CONTRACT',
] as const;

export type LeapsReasonCode = (typeof LEAPS_RESULT_REASON_CODES)[number] | (typeof LEAPS_CONTRACT_REASON_CODES)[number];

export interface LeapsReason {
  code: LeapsReasonCode;
  /** Code-specific qualifier, e.g. the metric id, the restriction kind or the provider failure code. */
  detail?: string;
  observed?: number | string | null;
  limit?: number | string | null;
  count?: number;
  message: string;
}

const TEMPLATES: Record<LeapsReasonCode, (r: Omit<LeapsReason, 'message'>) => string> = {
  LEAPS_NOT_EVALUATED_UNDERLYING_NOT_QUALIFIED: () => 'The underlying is not in SETUP or ACTIONABLE, so no contracts were evaluated.',
  LEAPS_NOT_EVALUATED_RUN_CAP: () => 'Not evaluated in this run (run limit reached); this is not a judgement of the contracts.',
  LEAPS_UNDERLYING_QUOTE_UNAVAILABLE: (r) => `No usable underlying price${r.detail ? ` (${r.detail})` : ''}.`,
  LEAPS_CHAIN_PROVIDER_FAILURE: (r) => `The option chain could not be loaded (${r.detail ?? 'provider failure'}).`,
  LEAPS_AUTH_EXPIRED: () => 'The TastyTrade session expired during the run; sign in again and re-run.',
  LEAPS_ACQUISITION_RESTRICTED: (r) => `Acquisition was limited (${r.detail}): ${r.count === undefined || r.count === null ? 'an unknown number of' : r.count} contracts not acquired.`,
  LEAPS_ACQUISITION_INCOMPLETE_QUOTE_LIMIT: (r) => `More than ${r.limit} contracts fall in the strike range (${r.observed}); nothing was quoted or ranked.`,
  LEAPS_RANKING_IS_EVALUATED_SUBSET: () => 'Ranked among the contracts that could be evaluated. A better contract may exist among those not acquired or not evaluable.',
  LEAPS_NO_LEAPS_EXPIRATIONS: () => 'No expiration falls in the LEAPS window.',
  LEAPS_NO_CONTRACTS_IN_WINDOW: () => 'Expirations exist, but no call is in the strike range below the stock price.',
  LEAPS_ALL_CONTRACTS_DATA_UNAVAILABLE: (r) => `Quotes arrived for ${r.count} contracts, but none had the data needed to evaluate it.`,
  LEAPS_ALL_QUOTES_UNAVAILABLE: (r) => `No usable quote arrived for any of the ${r.count} selected contracts.`,
  LEAPS_NO_SUITABLE_CONTRACT: () => 'Every contract in the complete chain was evaluated and none passes all gates.',
  LEAPS_NO_ELIGIBLE_IN_SUBSET: () => 'No evaluated contract passes all gates, but some contracts were not acquired; this is not a verdict on the whole chain.',
  LEAPS_GATE_FAILURE_COUNT: (r) => `${r.count} contract${r.count === 1 ? '' : 's'} failed ${r.detail}.`,
  CONTRACT_DTE_BELOW_MIN: (r) => `${r.observed} days to expiration is below the ${r.limit}-day minimum.`,
  CONTRACT_DTE_ABOVE_MAX: (r) => `${r.observed} days to expiration is above the ${r.limit}-day maximum.`,
  CONTRACT_DELTA_BELOW_MIN: (r) => `Delta ${r.observed} is below ${r.limit}.`,
  CONTRACT_DELTA_ABOVE_MAX: (r) => `Delta ${r.observed} is above ${r.limit}.`,
  CONTRACT_OI_BELOW_MIN: (r) => `Open interest ${r.observed} is below ${r.limit}.`,
  CONTRACT_SPREAD_ABOVE_MAX: (r) => `Bid-ask spread ${r.observed}% of mid is above ${r.limit}%.`,
  CONTRACT_EXTRINSIC_ABOVE_MAX: (r) => `Time value ${r.observed}% of the price is above ${r.limit}%.`,
  CONTRACT_NON_STANDARD_DELIVERABLE: (r) => `Adjusted contract: not evaluated (${r.detail}).`,
  INSTRUMENT_METADATA_UNAVAILABLE: (r) => `The contract's deliverable could not be verified (${r.detail}).`,
  CONTRACT_CROSSED_MARKET: () => 'The ask is below the bid (crossed market).',
  CONTRACT_QUOTE_ROW_MISSING: () => 'No usable quote row arrived for this contract.',
  CONTRACT_QUOTE_STALE: (r) => `The quote is stale (${r.detail}).`,
  CONTRACT_QUOTE_NOT_TWO_SIDED: () => 'Outside the session a closing quote needs a bid above zero and an ask above the bid.',
  CONTRACT_QUOTE_TIMESTAMP_MISSING: () => 'The quote has no timestamp.',
  QUOTE_TIMESTAMP_UNPARSEABLE: (r) => `The quote timestamp "${r.observed}" cannot be read.`,
  QUOTE_TIMESTAMP_IN_FUTURE: (r) => `The quote timestamp is ${r.observed} ms in the future (limit ${r.limit} ms).`,
  CONTRACT_QUOTE_SKEW_EXCEEDED: (r) => `Option and stock quotes are ${r.observed} ms apart (limit ${r.limit} ms).`,
  CONTRACT_LAST_SESSION_QUOTE: () => 'Closing values: the market is closed; review and ranking only, re-quote before any order.',
  CONTRACT_METRIC_UNAVAILABLE: (r) => `Required value ${r.detail} is unavailable.`,
  CONTRACT_METRIC_INVALID: (r) => `Required value ${r.detail} is invalid.`,
  INCOMPLETE_OPTIONAL_METRICS: (r) => `Optional values unavailable: ${r.detail}.`,
  CHAIN_DUPLICATE_CONTRACT: () => 'The contract appears more than once in the chain; none of its copies is used.',
};

export function leapsReason(reason: Omit<LeapsReason, 'message'>): LeapsReason {
  return { ...reason, message: TEMPLATES[reason.code](reason) };
}
