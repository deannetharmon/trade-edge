// lib/discovery/normalized/optionMetrics.ts

// LEAPS-QV-0001 Gate 2 (Sections 18, 25, 26) -- LEAPS contract, implied-volatility and event METRICS.
// Metrics only: no suitability thresholds, no contract ranking (Gate 4).
//
// Conventions (documented so a value cannot be misread):
//  * Prices in dollars per share; implied / historical volatility as a decimal fraction (0.35 = 35%).
//  * Pricing basis is the MID of bid and ask. A crossed market (ask < bid) is INVALID. A zero bid is allowed.
//  * LEAPS are calls. A non-call contract is INVALID, never reinterpreted.
//  * Provider strings are converted at this boundary (providerNumber); a missing value is never turned into 0
//    (the existing screener provider does `Number(item.open_interest || 0)`; that pattern is deliberately NOT used).
//  * Provider-computed IV Rank is exposed as `iv_rank_provider`, labelled with its source. It is NOT `iv_rank`:
//    Section 26 forbids an IV Rank without enough historical IV observations, and TradeEdge stores none, so the
//    internal rank / percentile are UNAVAILABLE.

import { invalidMetric, unavailableMetric, validMetric } from '../metrics';
import type { MetricSet, NormalizedMetric } from '../metrics';
import { epochDayOfDateString, epochDayOfIso } from './dates';
import { providerNumber } from './providerNumber';

export interface OptionMetricContext {
  /** Evaluation time (ISO-8601). */
  readonly now: string;
  /** Time of the quote / payload; null when the provider gives none (then the metrics cannot be VALID). */
  readonly quoteAsOf: string | null | undefined;
  readonly provider: string;
  readonly maxAgeMs?: number;
}

/** A live quote is only usable briefly; this is a data-freshness rule, not an investment rule. */
export const OPTION_QUOTE_MAX_AGE_MS = 15 * 60 * 1000;
export const CONTRACT_METRIC_IDS: readonly string[] = [
  'contract_dte',
  'contract_strike',
  'contract_bid',
  'contract_ask',
  'contract_mid',
  'contract_spread_pct_of_mid',
  'contract_delta',
  'contract_dollar_delta',
  'contract_theta',
  'contract_vega',
  'contract_implied_volatility',
  'contract_intrinsic_value',
  'contract_extrinsic_value',
  'contract_extrinsic_pct_of_mid',
  'contract_debit_per_contract',
  'contract_effective_leverage',
  'contract_breakeven_price',
  'contract_breakeven_move_pct',
  'contract_open_interest',
  'contract_volume',
];

function mark(raw: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) if (raw[key] !== undefined && raw[key] !== null && raw[key] !== '') return raw[key];
  return undefined;
}

type Num = NormalizedMetric<number>;
const valueOf = (m: NormalizedMetric): number | null => (m.validity === 'VALID' ? (m.value as number) : null);

/** Carries the first non-VALID input through, so a derived metric is never VALID on top of a bad input. */
function blocked(id: string, inputs: ReadonlyArray<NormalizedMetric>): NormalizedMetric | null {
  const bad = inputs.find((m) => m.validity !== 'VALID');
  if (!bad) return null;
  if (bad.validity === 'INVALID') return invalidMetric(id, bad.id, `INPUT_INVALID:${bad.id}`);
  return unavailableMetric(id, `INPUT_${bad.validity}:${bad.id}`);
}

/**
 * Contract metrics from one raw option row (provider key spellings: strike_price|strikePrice|strike, bid|bid_price,
 * ask|ask_price, delta, theta, vega, implied_volatility|iv, open_interest|open-interest|openInterest, volume, plus
 * expiration_date|expirationDate|expiration and option_type|optionType|type).
 * `underlyingPrice` must be a current price from the same moment as the quote.
 */
export function buildContractMetrics(
  raw: Record<string, unknown> | null | undefined,
  underlyingPrice: unknown,
  context: OptionMetricContext,
): MetricSet {
  const provenance = { provider: context.provider };
  const base = { asOf: context.quoteAsOf, now: context.now, maxAgeMs: context.maxAgeMs ?? OPTION_QUOTE_MAX_AGE_MS, provenance };
  if (!raw) {
    const none: Record<string, NormalizedMetric> = {};
    CONTRACT_METRIC_IDS.forEach((id) => {
      none[id] = unavailableMetric(id, 'NO_CONTRACT', provenance);
    });
    return none;
  }
  const positive = (what: string) => (v: number) => (v > 0 ? null : `${what}_NOT_POSITIVE`);
  const nonNegative = (what: string) => (v: number) => (v >= 0 ? null : `${what}_NEGATIVE`);

  const strike = providerNumber('contract_strike', mark(raw, 'strike_price', 'strikePrice', 'strike'), { ...base, rejectIf: positive('STRIKE') });
  const bid = providerNumber('contract_bid', mark(raw, 'bid', 'bid_price'), { ...base, rejectIf: nonNegative('BID') });
  const ask = providerNumber('contract_ask', mark(raw, 'ask', 'ask_price'), { ...base, rejectIf: positive('ASK') });
  const delta = providerNumber('contract_delta', mark(raw, 'delta'), {
    ...base,
    rejectIf: (v) => (v >= -1 && v <= 1 ? null : 'DELTA_OUT_OF_RANGE'),
  });
  const theta = providerNumber('contract_theta', mark(raw, 'theta'), base);
  const vega = providerNumber('contract_vega', mark(raw, 'vega'), { ...base, rejectIf: nonNegative('VEGA') });
  const iv = providerNumber('contract_implied_volatility', mark(raw, 'implied_volatility', 'iv', 'impliedVolatility'), {
    ...base,
    rejectIf: positive('IV'),
  });
  const openInterest = providerNumber('contract_open_interest', mark(raw, 'open_interest', 'open-interest', 'openInterest'), {
    ...base,
    rejectIf: (v) => (v >= 0 && Number.isInteger(v) ? null : 'OPEN_INTEREST_NOT_A_COUNT'),
  });
  const volume = providerNumber('contract_volume', mark(raw, 'volume'), {
    ...base,
    rejectIf: (v) => (v >= 0 && Number.isInteger(v) ? null : 'VOLUME_NOT_A_COUNT'),
  });
  const spot = providerNumber('underlying_price_for_contract', underlyingPrice, { ...base, rejectIf: positive('PRICE') });

  const type = String(mark(raw, 'option_type', 'optionType', 'type') ?? '').trim().toLowerCase();
  const isCall = type === 'c' || type === 'call';
  const typeMissing = type === '';

  const expirationRaw = mark(raw, 'expiration_date', 'expirationDate', 'expiration');
  const expirationDay = epochDayOfDateString(expirationRaw);
  const nowDay = epochDayOfIso(context.now);
  let dte: NormalizedMetric;
  if (expirationRaw === undefined) dte = unavailableMetric('contract_dte', 'EXPIRATION_MISSING', provenance);
  else if (expirationDay === null || nowDay === null) dte = invalidMetric('contract_dte', expirationRaw, 'EXPIRATION_NOT_A_DATE', provenance);
  else if (expirationDay < nowDay) dte = invalidMetric('contract_dte', expirationRaw, 'EXPIRATION_IN_THE_PAST', provenance);
  else dte = providerNumber('contract_dte', expirationDay - nowDay, base);

  const out: Record<string, NormalizedMetric> = {
    contract_dte: dte,
    contract_strike: strike,
    contract_bid: bid,
    contract_ask: ask,
    contract_delta: delta,
    contract_theta: theta,
    contract_vega: vega,
    contract_implied_volatility: iv,
    contract_open_interest: openInterest,
    contract_volume: volume,
  };

  if (!typeMissing && !isCall) {
    // A put (or unknown type) must not yield call-shaped numbers.
    CONTRACT_METRIC_IDS.forEach((id) => {
      out[id] = invalidMetric(id, type, 'LEAPS_METRICS_REQUIRE_A_CALL', provenance);
    });
    return out;
  }
  // Call-specific derivations need to know the contract is a call; a missing type blocks them (never assumed).
  const typeBlock = (id: string): NormalizedMetric | null =>
    typeMissing ? unavailableMetric(id, 'OPTION_TYPE_MISSING', provenance) : null;

  const b = valueOf(bid);
  const a = valueOf(ask);
  let mid: NormalizedMetric;
  if (b !== null && a !== null && a < b) mid = invalidMetric('contract_mid', `${b}/${a}`, 'CROSSED_MARKET', provenance);
  else mid = blocked('contract_mid', [bid, ask]) ?? providerNumber('contract_mid', ((b as number) + (a as number)) / 2, base);
  out.contract_mid = mid;
  const m = valueOf(mid);

  out.contract_spread_pct_of_mid = blocked('contract_spread_pct_of_mid', [mid, bid, ask])
    ?? providerNumber('contract_spread_pct_of_mid', (((a as number) - (b as number)) / (m as number)) * 100, base);

  const S = valueOf(spot);
  const K = valueOf(strike);
  const d = valueOf(delta);
  out.contract_dollar_delta = typeBlock('contract_dollar_delta') ?? blocked('contract_dollar_delta', [delta, spot])
    ?? providerNumber('contract_dollar_delta', (d as number) * (S as number) * 100, base);

  const intrinsic: NormalizedMetric = typeBlock('contract_intrinsic_value') ?? blocked('contract_intrinsic_value', [spot, strike])
    ?? providerNumber('contract_intrinsic_value', Math.max(0, (S as number) - (K as number)), base);
  out.contract_intrinsic_value = intrinsic;
  const intrinsicValue = valueOf(intrinsic);

  let extrinsic: NormalizedMetric;
  if (typeMissing) extrinsic = unavailableMetric('contract_extrinsic_value', 'OPTION_TYPE_MISSING', provenance);
  else {
    const gate = blocked('contract_extrinsic_value', [mid, intrinsic]);
    if (gate) extrinsic = gate;
    else if ((m as number) < (intrinsicValue as number)) {
      extrinsic = invalidMetric('contract_extrinsic_value', `${m}<${intrinsicValue}`, 'MID_BELOW_INTRINSIC', provenance);
    } else extrinsic = providerNumber('contract_extrinsic_value', (m as number) - (intrinsicValue as number), base);
  }
  out.contract_extrinsic_value = extrinsic;
  const ext = valueOf(extrinsic);
  out.contract_extrinsic_pct_of_mid = blocked('contract_extrinsic_pct_of_mid', [extrinsic, mid])
    ?? providerNumber('contract_extrinsic_pct_of_mid', ((ext as number) / (m as number)) * 100, base);

  out.contract_debit_per_contract = blocked('contract_debit_per_contract', [mid])
    ?? providerNumber('contract_debit_per_contract', (m as number) * 100, base);
  out.contract_effective_leverage = typeBlock('contract_effective_leverage') ?? blocked('contract_effective_leverage', [delta, spot, mid])
    ?? providerNumber('contract_effective_leverage', ((d as number) * (S as number)) / (m as number), base);
  out.contract_breakeven_price = typeBlock('contract_breakeven_price') ?? blocked('contract_breakeven_price', [strike, mid])
    ?? providerNumber('contract_breakeven_price', (K as number) + (m as number), base);
  const be = valueOf(out.contract_breakeven_price);
  out.contract_breakeven_move_pct = blocked('contract_breakeven_move_pct', [out.contract_breakeven_price, spot])
    ?? providerNumber('contract_breakeven_move_pct', ((be as number) / (S as number) - 1) * 100, base);

  CONTRACT_METRIC_IDS.forEach((id) => {
    if (!out[id]) out[id] = unavailableMetric(id, 'NOT_DERIVED', provenance);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Underlying implied volatility, provider IV Rank, earnings date, beta (TastyTrade market-metrics item)
// ---------------------------------------------------------------------------

export const VOLATILITY_EVENT_METRIC_IDS: readonly string[] = [
  'implied_volatility_index',
  'implied_volatility_30d',
  'historical_volatility_30d',
  'iv_rank_provider',
  'iv_rank_internal',
  'iv_percentile_internal',
  'underlying_liquidity_rating',
  'underlying_beta',
  'next_earnings_date',
  'days_to_next_earnings',
];

export interface MarketMetricsContext {
  readonly now: string;
  /** When the market-metrics payload was fetched / updated. */
  readonly payloadAsOf: string | null | undefined;
  readonly maxAgeMs?: number;
}

/** Market-metrics are daily-ish figures; one trading day plus slack. */
export const MARKET_METRICS_MAX_AGE_MS = 36 * 60 * 60 * 1000;

/**
 * Historical IV series do not exist in TradeEdge (audit finding), so the internally computed IV Rank and
 * percentile are always UNAVAILABLE. This is a statement of fact, not a default.
 */
export function historicalIvMetrics(): MetricSet {
  return {
    iv_rank_internal: unavailableMetric('iv_rank_internal', 'NO_HISTORICAL_IV_SERIES'),
    iv_percentile_internal: unavailableMetric('iv_percentile_internal', 'NO_HISTORICAL_IV_SERIES'),
  };
}

/** One TastyTrade `/market-metrics` item (kebab-case, decimals as strings or numbers). */
export function buildMarketMetrics(raw: Record<string, unknown> | null | undefined, context: MarketMetricsContext): MetricSet {
  const provenance = (field: string) => ({ provider: 'tastytrade', field });
  const base = (field: string) => ({
    asOf: context.payloadAsOf,
    now: context.now,
    maxAgeMs: context.maxAgeMs ?? MARKET_METRICS_MAX_AGE_MS,
    provenance: provenance(field),
  });
  const out: Record<string, NormalizedMetric> = { ...historicalIvMetrics() };
  const ids = VOLATILITY_EVENT_METRIC_IDS.filter((id) => !out[id]);
  if (!raw) {
    ids.forEach((id) => {
      out[id] = unavailableMetric(id, 'NO_MARKET_METRICS_PAYLOAD');
    });
    return out;
  }
  const positive = (what: string) => (v: number) => (v > 0 ? null : `${what}_NOT_POSITIVE`);
  const get = (key: string): unknown => raw[key];

  out.implied_volatility_index = providerNumber('implied_volatility_index', get('implied-volatility-index'), { ...base('implied-volatility-index'), rejectIf: positive('IV') });
  out.implied_volatility_30d = providerNumber('implied_volatility_30d', get('implied-volatility-30-day'), { ...base('implied-volatility-30-day'), rejectIf: positive('IV') });
  out.historical_volatility_30d = providerNumber('historical_volatility_30d', get('historical-volatility-30-day'), { ...base('historical-volatility-30-day'), rejectIf: positive('HV') });
  out.iv_rank_provider = providerNumber('iv_rank_provider', get('implied-volatility-index-rank'), {
    ...base('implied-volatility-index-rank'),
    rejectIf: (v) => (v >= 0 && v <= 1 ? null : 'IV_RANK_OUT_OF_RANGE'),
  });
  out.underlying_liquidity_rating = providerNumber('underlying_liquidity_rating', get('liquidity-rating'), {
    ...base('liquidity-rating'),
    rejectIf: (v) => (Number.isInteger(v) && v >= 1 && v <= 5 ? null : 'LIQUIDITY_RATING_OUT_OF_RANGE'),
  });
  // Only the 'beta' field. 'beta-60-day' is a different window and is never substituted for it.
  out.underlying_beta = providerNumber('underlying_beta', get('beta'), base('beta'));

  const earnings = raw.earnings && typeof raw.earnings === 'object' ? (raw.earnings as Record<string, unknown>) : null;
  const dateRaw = earnings ? earnings['expected-report-date'] : undefined;
  const nowDay = epochDayOfIso(context.now);
  if (dateRaw === undefined || dateRaw === null || dateRaw === '') {
    out.next_earnings_date = unavailableMetric('next_earnings_date', 'NO_EXPECTED_REPORT_DATE', provenance('earnings.expected-report-date'));
    out.days_to_next_earnings = unavailableMetric('days_to_next_earnings', 'NO_EXPECTED_REPORT_DATE', provenance('earnings.expected-report-date'));
  } else {
    const day = epochDayOfDateString(dateRaw);
    if (day === null || nowDay === null) {
      out.next_earnings_date = invalidMetric('next_earnings_date', dateRaw, 'NOT_A_DATE', provenance('earnings.expected-report-date'));
      out.days_to_next_earnings = invalidMetric('days_to_next_earnings', dateRaw, 'NOT_A_DATE', provenance('earnings.expected-report-date'));
    } else if (day < nowDay) {
      out.next_earnings_date = invalidMetric('next_earnings_date', dateRaw, 'REPORT_DATE_IN_THE_PAST', provenance('earnings.expected-report-date'));
      out.days_to_next_earnings = invalidMetric('days_to_next_earnings', dateRaw, 'REPORT_DATE_IN_THE_PAST', provenance('earnings.expected-report-date'));
    } else {
      // Date strings are text metrics: only a VALID metric carries `value`.
      const days = providerNumber('days_to_next_earnings', day - nowDay, base('earnings.expected-report-date'));
      out.days_to_next_earnings = days;
      out.next_earnings_date = days.validity === 'VALID'
        ? validMetric('next_earnings_date', dateRaw as string, days.asOf, provenance('earnings.expected-report-date'))
        : { ...days, id: 'next_earnings_date' };
    }
  }
  return out;
}
