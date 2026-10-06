// lib/discovery/leaps/evaluate.ts

// LEAPS-QV-0001 Gate 4b -- pure contract evaluator (spec Sections 2, 4.3, 4.4, 5, 6, 7, 8; rulings I2-I9, I12, Q2, Q5,
// Q7 of revision 4). Input: one underlying's Gate 3 state and its 4a acquisition. Output: LeapsEvaluation.
// No clock, no network: `now` is passed in. Gate 3's StrategyEvaluation is never read for anything but the state.
//
// Every selected contract ends in exactly one class: ELIGIBLE, INELIGIBLE (a verified gate or deliverable failure),
// QUOTE_ROW_MISSING (no usable row) or NOT_EVALUABLE (row received, a required input unavailable / stale / invalid).
// unresolvedTotal = missing + notEvaluable; selected = eligible + ineligible + unresolvedTotal (tested).

import type { MetricSet, NormalizedMetric } from '../metrics';
import { invalidMetric, unavailableMetric } from '../metrics';
import { buildContractMetrics } from '../normalized/optionMetrics';
import { providerNumber } from '../normalized/providerNumber';
import { latestCompletedSession, marketSessionState, sessionCloseEpochSeconds } from '../normalized/exchangeCalendar';
import type { AcquisitionReport, LeapsChainAcquisition, RawInstrumentEvidence, RawLeapsContract } from './acquisition';
import type { QvLeapsPolicy } from './policy';
import { compareLeapsRank, scoreLeapsContract } from './rank';
import { leapsReason, type LeapsReason } from './reasons';

export type LeapsContractStatus = 'EVALUATED' | 'NOT_EVALUATED' | 'DATA_UNAVAILABLE' | 'NO_SUITABLE_CONTRACT' | 'NO_ELIGIBLE_IN_SUBSET';
export type LeapsQuoteMode = 'LIVE' | 'LAST_SESSION';
export type ContractResolution = 'ELIGIBLE' | 'INELIGIBLE' | 'QUOTE_ROW_MISSING' | 'NOT_EVALUABLE';

export interface LeapsGateResult {
  id: 'dte' | 'delta' | 'open_interest' | 'spread' | 'extrinsic';
  status: 'pass' | 'fail';
  reason?: LeapsReason;
}

export interface ContractEvaluation {
  occSymbol: string;
  expiration: string;
  strike: number | null;
  quoteMode: LeapsQuoteMode | null;
  metrics: MetricSet;
  eligibility: 'ELIGIBLE' | 'INELIGIBLE' | 'DATA_UNAVAILABLE';
  resolution: ContractResolution;
  gates: LeapsGateResult[];
  reasons: LeapsReason[];
  rank: number | null;
  score: number | null;
  scoreComponents: { timeValueCost: number; liquidity: number } | null;
}

export interface LeapsEvaluation {
  symbol: string;
  policyVersion: string;
  contractStatus: LeapsContractStatus;
  rankingScope: 'COMPLETE_CHAIN' | 'EVALUATED_SUBSET' | null;
  quoteMode: LeapsQuoteMode | null;
  /** The single S used for selection and evaluation, and its basis (I6). */
  spot: { price: number; basis: 'LAST' | 'REGULAR_SESSION_CLOSE' } | null;
  acquisition: AcquisitionReport | null;
  reasons: LeapsReason[];
  /** Ranked eligible contracts first (rank 1..n), then every other evaluated contract. */
  contracts: ContractEvaluation[];
  counts: {
    selected: number;
    eligible: number;
    ineligible: number;
    quoteRowsMissing: number;
    acquiredNotEvaluable: number;
    unresolvedTotal: number;
    omittedExpirations: number;
    omittedContractsByDesign: number | null;
  };
}

export interface LeapsEvaluationInput {
  symbol: string;
  underlyingState: string;
  /** ISO-8601 evaluation instant, read once by the caller after all provider I/O (4.1). */
  now: string;
  acquisition: LeapsChainAcquisition;
  policy: QvLeapsPolicy;
}

const REQUIRED_METRICS = [
  'contract_strike', 'contract_dte', 'contract_bid', 'contract_ask', 'contract_mid', 'contract_spread_pct_of_mid',
  'contract_delta', 'contract_open_interest', 'contract_intrinsic_value', 'contract_extrinsic_value',
  'contract_extrinsic_pct_of_mid', 'contract_breakeven_move_pct',
];
const OPTIONAL_METRICS = ['contract_theta', 'contract_vega', 'contract_implied_volatility', 'contract_volume'];
const MULTIPLIER_METRICS = ['contract_dollar_delta', 'contract_debit_per_contract'];

const valueOf = (m: NormalizedMetric | undefined): number | null => (m && m.validity === 'VALID' ? (m.value as number) : null);

// ---------------------------------------------------------------------------------------------------------------
// Timestamps and quote modes (4.3 as ruled)
// ---------------------------------------------------------------------------------------------------------------

type TimestampCheck = { ok: true; ms: number } | { ok: false; reason: LeapsReason };

function parseQuoteTime(raw: unknown, nowMs: number, policy: QvLeapsPolicy): TimestampCheck {
  if (raw === undefined || raw === null || raw === '') return { ok: false, reason: leapsReason({ code: 'CONTRACT_QUOTE_TIMESTAMP_MISSING' }) };
  // Audit 3b: ISO-8601 UTC with milliseconds. Epoch numbers are not accepted (unit would be ambiguous).
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(raw)) {
    return { ok: false, reason: leapsReason({ code: 'QUOTE_TIMESTAMP_UNPARSEABLE', observed: String(raw) }) };
  }
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return { ok: false, reason: leapsReason({ code: 'QUOTE_TIMESTAMP_UNPARSEABLE', observed: raw }) };
  if (ms - nowMs > policy.quotes.futureToleranceMs) {
    return { ok: false, reason: leapsReason({ code: 'QUOTE_TIMESTAMP_IN_FUTURE', observed: ms - nowMs, limit: policy.quotes.futureToleranceMs }) };
  }
  return { ok: true, ms };
}

interface QuoteWindow {
  mode: LeapsQuoteMode;
  /** Earliest acceptable quote time (ms). */
  earliestMs: number;
}

function quoteWindow(nowMs: number, policy: QvLeapsPolicy): QuoteWindow | null {
  const state = marketSessionState(nowMs / 1000);
  if (state === null) return null;
  if (state === 'REGULAR_HOURS') return { mode: 'LIVE', earliestMs: nowMs - policy.quotes.liveMaxAgeMs };
  // I12: outside the session a quote stamped at or after (latest completed close - W) is last-session evidence; the
  // provider re-stamps frozen quotes about 20:00 ET, so any later stamp up to now is accepted.
  const session = latestCompletedSession(nowMs / 1000);
  const close = session === null ? null : sessionCloseEpochSeconds(session);
  if (close === null) return null;
  return { mode: 'LAST_SESSION', earliestMs: close * 1000 - policy.quotes.lastSessionWindowMs };
}

// ---------------------------------------------------------------------------------------------------------------
// Instrument evidence (4.4, I8)
// ---------------------------------------------------------------------------------------------------------------

type InstrumentCheck = { status: 'STANDARD' } | { status: 'NON_STANDARD' | 'UNVERIFIED'; detail: string };

function occRoot(occ: string): string {
  return occ.slice(0, 6).trim();
}

function checkInstrument(symbol: string, occ: string, ev: RawInstrumentEvidence, policy: QvLeapsPolicy): InstrumentCheck {
  if (typeof ev.optionChainType === 'string' && ev.optionChainType !== 'Standard') return { status: 'NON_STANDARD', detail: `chain type ${ev.optionChainType}` };
  const spc = typeof ev.sharesPerContract === 'number' || typeof ev.sharesPerContract === 'string' ? Number(ev.sharesPerContract) : NaN;
  if (ev.sharesPerContract === null || ev.sharesPerContract === undefined || ev.sharesPerContract === '') return { status: 'UNVERIFIED', detail: 'shares per contract missing' };
  if (!Number.isFinite(spc)) return { status: 'UNVERIFIED', detail: 'shares per contract unreadable' };
  if (spc !== policy.instrument.sharesPerContract) return { status: 'NON_STANDARD', detail: `${spc} shares per contract` };
  if (typeof ev.rootSymbol !== 'string' || ev.rootSymbol === '') return { status: 'UNVERIFIED', detail: 'root symbol missing' };
  if (ev.rootSymbol !== symbol || occRoot(occ) !== symbol) return { status: 'NON_STANDARD', detail: `root ${ev.rootSymbol}` };
  if (!Array.isArray(ev.deliverables) || ev.deliverables.length === 0) return { status: 'UNVERIFIED', detail: 'deliverable record missing' };
  const items = ev.deliverables as Record<string, unknown>[];
  const standard = items.length === 1
    && String(items[0]['deliverable-type'] ?? '') === 'Shares'
    && String(items[0].symbol ?? '') === symbol
    && Number(items[0].amount) === policy.instrument.sharesPerContract;
  return standard ? { status: 'STANDARD' } : { status: 'NON_STANDARD', detail: 'deliverable is not 100 shares of the underlying' };
}

// ---------------------------------------------------------------------------------------------------------------
// One contract
// ---------------------------------------------------------------------------------------------------------------

function gateCompare(observed: number, limit: number, policy: QvLeapsPolicy): number {
  const q = (x: number) => Math.round(x * policy.gateQuantum);
  return q(observed) - q(limit);
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

interface ContractContext {
  symbol: string;
  now: string;
  nowMs: number;
  spot: number;
  underlyingMs: number;
  window: QuoteWindow;
  policy: QvLeapsPolicy;
}

function emptyMetrics(reason: string): MetricSet {
  const out: Record<string, NormalizedMetric> = {};
  [...REQUIRED_METRICS, ...OPTIONAL_METRICS, ...MULTIPLIER_METRICS].forEach((id) => { out[id] = unavailableMetric(id, reason); });
  return out;
}

function evaluateContract(raw: RawLeapsContract, ctx: ContractContext): ContractEvaluation {
  const { policy } = ctx;
  const base = { occSymbol: raw.occSymbol, expiration: raw.expiration, strike: raw.strike, rank: null, score: null, scoreComponents: null, gates: [] as LeapsGateResult[] };
  const unresolved = (resolution: 'QUOTE_ROW_MISSING' | 'NOT_EVALUABLE', reasons: LeapsReason[], metrics: MetricSet, quoteMode: LeapsQuoteMode | null = null): ContractEvaluation =>
    ({ ...base, quoteMode, metrics, eligibility: 'DATA_UNAVAILABLE', resolution, reasons });

  if (raw.duplicateInChain) return unresolved('NOT_EVALUABLE', [leapsReason({ code: 'CHAIN_DUPLICATE_CONTRACT' })], emptyMetrics('CHAIN_DUPLICATE_CONTRACT'));
  if (raw.quote === null) {
    const reasons = [leapsReason({ code: raw.duplicateQuoteRows ? 'CHAIN_DUPLICATE_CONTRACT' : 'CONTRACT_QUOTE_ROW_MISSING' })];
    return unresolved('QUOTE_ROW_MISSING', reasons, emptyMetrics('QUOTE_ROW_MISSING'));
  }

  // Deliverable (I8): verified non-standard is a definitive refusal; unverifiable evidence is a data gap.
  const instrument = checkInstrument(ctx.symbol, raw.occSymbol, raw.instrument, policy);
  if (instrument.status === 'NON_STANDARD') {
    return { ...base, quoteMode: null, metrics: emptyMetrics('CONTRACT_NON_STANDARD_DELIVERABLE'), eligibility: 'INELIGIBLE', resolution: 'INELIGIBLE', reasons: [leapsReason({ code: 'CONTRACT_NON_STANDARD_DELIVERABLE', detail: instrument.detail })] };
  }

  // Quote time: parse, then the mode rule, then (LIVE only) skew against the underlying.
  const quote = raw.quote;
  const time = parseQuoteTime(quote['updated-at'], ctx.nowMs, policy);
  const reasons: LeapsReason[] = [];
  let timeOk = time.ok;
  if (!time.ok) reasons.push(time.reason);
  else if (time.ms < ctx.window.earliestMs) {
    timeOk = false;
    reasons.push(leapsReason({ code: 'CONTRACT_QUOTE_STALE', detail: ctx.window.mode === 'LIVE' ? 'older than 15 minutes during the session' : 'not from the latest completed session' }));
  } else if (ctx.window.mode === 'LIVE' && Math.abs(time.ms - ctx.underlyingMs) > policy.quotes.skewMaxMs) {
    timeOk = false;
    reasons.push(leapsReason({ code: 'CONTRACT_QUOTE_SKEW_EXCEEDED', observed: Math.abs(time.ms - ctx.underlyingMs), limit: policy.quotes.skewMaxMs }));
  }

  // Metrics through the Gate 2 builder. Freshness is decided above (quote mode), so no max age is passed; a stamp
  // inside the 5 s future tolerance is built at `now` (the builder rejects any future stamp).
  const asOf = time.ok ? (time.ms > ctx.nowMs ? ctx.now : String(quote['updated-at'])) : null;
  const built = buildContractMetrics(
    {
      ...quote,
      strike_price: raw.strike,
      option_type: 'C',
      expiration_date: raw.expiration,
      implied_volatility: quote.volatility, // audit 3d: a decimal fraction, as the builder expects
    },
    ctx.spot,
    { now: ctx.now, quoteAsOf: asOf ?? ctx.now, provider: 'tastytrade', maxAgeMs: Number.MAX_SAFE_INTEGER },
  );
  const metrics: Record<string, NormalizedMetric> = { ...built };
  // DTE on the New York calendar date (the date acquisition selected on), not the UTC date.
  metrics.contract_dte = providerNumber('contract_dte', raw.dte, { asOf: asOf ?? ctx.now, now: ctx.now });
  if (instrument.status !== 'STANDARD') {
    MULTIPLIER_METRICS.forEach((id) => { metrics[id] = unavailableMetric(id, 'INSTRUMENT_MULTIPLIER_UNAVAILABLE'); });
  }
  if (!time.ok) {
    [...REQUIRED_METRICS, ...OPTIONAL_METRICS, ...MULTIPLIER_METRICS].forEach((id) => {
      if (metrics[id].validity === 'VALID') metrics[id] = invalidMetric(id, quote['updated-at'], 'QUOTE_TIMESTAMP_REJECTED');
    });
  }

  if (instrument.status === 'UNVERIFIED') reasons.push(leapsReason({ code: 'INSTRUMENT_METADATA_UNAVAILABLE', detail: instrument.detail }));
  const bid = valueOf(metrics.contract_bid);
  const ask = valueOf(metrics.contract_ask);
  if (metrics.contract_mid.validity === 'INVALID' && metrics.contract_mid.reason === 'CROSSED_MARKET') {
    reasons.push(leapsReason({ code: 'CONTRACT_CROSSED_MARKET' }));
  }
  // Ian (I12 condition b): a closing quote must be two-sided; a frozen one-sided or locked quote is not evidence.
  if (ctx.window.mode === 'LAST_SESSION' && bid !== null && ask !== null && !(bid > 0 && ask > bid)) {
    reasons.push(leapsReason({ code: 'CONTRACT_QUOTE_NOT_TWO_SIDED' }));
  }
  if (timeOk) {
    REQUIRED_METRICS.forEach((id) => {
      const m = metrics[id];
      if (m.validity === 'VALID') return;
      if (id === 'contract_mid' && m.validity === 'INVALID' && m.reason === 'CROSSED_MARKET') return;
      reasons.push(leapsReason({ code: m.validity === 'INVALID' ? 'CONTRACT_METRIC_INVALID' : 'CONTRACT_METRIC_UNAVAILABLE', detail: id }));
    });
  }
  const quoteMode = time.ok ? ctx.window.mode : null;
  if (reasons.length > 0) return unresolved('NOT_EVALUABLE', reasons, metrics, quoteMode);

  // Gates (Section 7): every gate is evaluated, so all failing reasons are reported.
  const g = policy.gates;
  const dte = valueOf(metrics.contract_dte) as number;
  const delta = valueOf(metrics.contract_delta) as number;
  const oi = valueOf(metrics.contract_open_interest) as number;
  const spread = valueOf(metrics.contract_spread_pct_of_mid) as number;
  const extPct = valueOf(metrics.contract_extrinsic_pct_of_mid) as number;
  const gates: LeapsGateResult[] = [];
  const gate = (id: LeapsGateResult['id'], failure: LeapsReason | null) => gates.push(failure ? { id, status: 'fail', reason: failure } : { id, status: 'pass' });
  gate('dte', gateCompare(dte, g.dteMin, policy) < 0 ? leapsReason({ code: 'CONTRACT_DTE_BELOW_MIN', observed: dte, limit: g.dteMin })
    : gateCompare(dte, g.dteMax, policy) > 0 ? leapsReason({ code: 'CONTRACT_DTE_ABOVE_MAX', observed: dte, limit: g.dteMax }) : null);
  gate('delta', gateCompare(delta, g.deltaMin, policy) < 0 ? leapsReason({ code: 'CONTRACT_DELTA_BELOW_MIN', observed: delta, limit: g.deltaMin })
    : gateCompare(delta, g.deltaMax, policy) > 0 ? leapsReason({ code: 'CONTRACT_DELTA_ABOVE_MAX', observed: delta, limit: g.deltaMax }) : null);
  gate('open_interest', gateCompare(oi, g.openInterestMin, policy) < 0 ? leapsReason({ code: 'CONTRACT_OI_BELOW_MIN', observed: oi, limit: g.openInterestMin }) : null);
  gate('spread', gateCompare(spread, g.spreadPctMax, policy) > 0 ? leapsReason({ code: 'CONTRACT_SPREAD_ABOVE_MAX', observed: round6(spread), limit: g.spreadPctMax }) : null);
  gate('extrinsic', gateCompare(extPct, g.extrinsicPctMax, policy) > 0 ? leapsReason({ code: 'CONTRACT_EXTRINSIC_ABOVE_MAX', observed: round6(extPct), limit: g.extrinsicPctMax }) : null);

  const flags: LeapsReason[] = [];
  if (quoteMode === 'LAST_SESSION') flags.push(leapsReason({ code: 'CONTRACT_LAST_SESSION_QUOTE' }));
  const missingOptional = OPTIONAL_METRICS.filter((id) => metrics[id].validity !== 'VALID');
  if (missingOptional.length > 0) flags.push(leapsReason({ code: 'INCOMPLETE_OPTIONAL_METRICS', detail: missingOptional.join(',') }));

  const failed = gates.filter((x) => x.status === 'fail');
  if (failed.length > 0) {
    return { ...base, quoteMode, metrics, eligibility: 'INELIGIBLE', resolution: 'INELIGIBLE', gates, reasons: [...failed.map((x) => x.reason as LeapsReason), ...flags] };
  }
  const scored = scoreLeapsContract({ breakevenMovePct: valueOf(metrics.contract_breakeven_move_pct) as number, spreadPctOfMid: spread, openInterest: oi }, policy);
  return { ...base, quoteMode, metrics, eligibility: 'ELIGIBLE', resolution: 'ELIGIBLE', gates, reasons: flags, score: scored.score, scoreComponents: scored.components };
}

// ---------------------------------------------------------------------------------------------------------------
// One underlying (Section 6 precedence)
// ---------------------------------------------------------------------------------------------------------------

function omittedByDesign(report: AcquisitionReport): number | null {
  let total = 0;
  for (const r of report.restrictions) {
    if (r.kind === 'STRIKES_UNAVAILABLE') return null;
    if (r.kind === 'EXPIRATION_CAP') {
      if (r.omittedContracts === null) return null;
      total += r.omittedContracts;
    }
    if (r.kind === 'QUOTE_LIMIT') total += r.omittedContracts;
  }
  return total;
}

function quoteLimitOf(report: AcquisitionReport): number | null {
  for (const r of report.restrictions) if (r.kind === 'QUOTE_LIMIT') return r.limit;
  return null;
}

function restrictionReasons(report: AcquisitionReport): LeapsReason[] {
  return report.restrictions.map((r) => {
    if (r.kind === 'EXPIRATION_CAP') return leapsReason({ code: 'LEAPS_ACQUISITION_RESTRICTED', detail: `EXPIRATION_CAP: ${r.omittedExpirations} expirations`, count: r.omittedContracts ?? undefined });
    if (r.kind === 'QUOTE_LIMIT') return leapsReason({ code: 'LEAPS_ACQUISITION_RESTRICTED', detail: 'QUOTE_LIMIT', count: r.omittedContracts });
    if (r.kind === 'CHUNK_FAILURE') return leapsReason({ code: 'LEAPS_ACQUISITION_RESTRICTED', detail: `CHUNK_FAILURE: ${r.failedChunks} requests`, count: 0 });
    return leapsReason({ code: 'LEAPS_ACQUISITION_RESTRICTED', detail: `STRIKES_UNAVAILABLE: ${r.expirations} expirations` });
  });
}

function gateFailureCounts(contracts: ContractEvaluation[]): LeapsReason[] {
  const counts: Record<string, number> = {};
  contracts.forEach((c) => {
    if (c.resolution !== 'INELIGIBLE') return;
    c.reasons.forEach((r) => {
      if (r.code.indexOf('CONTRACT_') === 0 && r.code !== 'CONTRACT_LAST_SESSION_QUOTE') counts[r.code] = (counts[r.code] ?? 0) + 1;
    });
  });
  return Object.keys(counts).sort().map((code) => leapsReason({ code: 'LEAPS_GATE_FAILURE_COUNT', detail: code, count: counts[code] }));
}

export function evaluateLeaps(input: LeapsEvaluationInput): LeapsEvaluation {
  const { policy, acquisition: acq } = input;
  const zero = { selected: 0, eligible: 0, ineligible: 0, quoteRowsMissing: 0, acquiredNotEvaluable: 0, unresolvedTotal: 0, omittedExpirations: 0, omittedContractsByDesign: 0 };
  const shell = (status: LeapsContractStatus, reasons: LeapsReason[], quoteMode: LeapsQuoteMode | null = null): LeapsEvaluation => ({
    symbol: input.symbol, policyVersion: policy.version, contractStatus: status, rankingScope: null, quoteMode, spot: acq.spot,
    acquisition: acq.chain?.acquisition ?? null, reasons, contracts: [], counts: { ...zero },
  });

  // Rule 1: only SETUP / ACTIONABLE underlyings are evaluated.
  if (input.underlyingState !== 'SETUP' && input.underlyingState !== 'ACTIONABLE') {
    return shell('NOT_EVALUATED', [leapsReason({ code: 'LEAPS_NOT_EVALUATED_UNDERLYING_NOT_QUALIFIED' })]);
  }
  if (acq.status === 'NOT_EVALUATED_RUN_CAP') return shell('NOT_EVALUATED', [leapsReason({ code: 'LEAPS_NOT_EVALUATED_RUN_CAP' })]);

  // Rule 2: underlying, provider and acquisition failures.
  if (acq.status === 'AUTH_EXPIRED') return shell('DATA_UNAVAILABLE', [leapsReason({ code: 'LEAPS_AUTH_EXPIRED' })]);
  if (acq.status === 'CHAIN_FAILED' || !acq.chain || acq.chain.acquisition.coverage === 'FAILED') {
    const code = (acq.reason ?? 'LEAPS_CHAIN_PROVIDER_FAILURE:UNKNOWN').split(':');
    return shell('DATA_UNAVAILABLE', [leapsReason({ code: 'LEAPS_CHAIN_PROVIDER_FAILURE', detail: code.slice(1).join(':') || 'UNKNOWN' })]);
  }
  const nowMs = Date.parse(input.now);
  const window = Number.isFinite(nowMs) ? quoteWindow(nowMs, policy) : null;
  if (acq.status === 'UNDERLYING_QUOTE_UNAVAILABLE' || !acq.spot || !acq.underlying || window === null) {
    return shell('DATA_UNAVAILABLE', [leapsReason({ code: 'LEAPS_UNDERLYING_QUOTE_UNAVAILABLE', detail: window === null ? 'calendar cannot classify the session' : 'no price' })]);
  }
  // The underlying is held to the same quote rule as the options (4.3).
  const uTime = parseQuoteTime(acq.underlying.fields['updated-at'], nowMs, policy);
  if (!uTime.ok) return shell('DATA_UNAVAILABLE', [leapsReason({ code: 'LEAPS_UNDERLYING_QUOTE_UNAVAILABLE', detail: uTime.reason.message })], window.mode);
  if (uTime.ms < window.earliestMs) return shell('DATA_UNAVAILABLE', [leapsReason({ code: 'LEAPS_UNDERLYING_QUOTE_UNAVAILABLE', detail: 'stale underlying quote' })], window.mode);

  const report = acq.chain.acquisition;
  if (report.quoteLimitExceeded) {
    const evaluation = shell('DATA_UNAVAILABLE', [
      leapsReason({ code: 'LEAPS_ACQUISITION_INCOMPLETE_QUOTE_LIMIT', observed: report.contracts.omittedByQuoteLimit, limit: quoteLimitOf(report) }),
    ], window.mode);
    evaluation.counts.omittedExpirations = report.expirations.omittedByCap;
    evaluation.counts.omittedContractsByDesign = omittedByDesign(report);
    return evaluation;
  }

  const ctx: ContractContext = { symbol: input.symbol, now: input.now, nowMs, spot: acq.spot.price, underlyingMs: uTime.ms, window, policy };
  const evaluated = acq.chain.contracts.map((c) => evaluateContract(c, ctx));

  const eligible = evaluated.filter((c) => c.resolution === 'ELIGIBLE');
  const ineligible = evaluated.filter((c) => c.resolution === 'INELIGIBLE');
  const missing = evaluated.filter((c) => c.resolution === 'QUOTE_ROW_MISSING');
  const notEvaluable = evaluated.filter((c) => c.resolution === 'NOT_EVALUABLE');
  const counts = {
    selected: evaluated.length,
    eligible: eligible.length,
    ineligible: ineligible.length,
    quoteRowsMissing: missing.length,
    acquiredNotEvaluable: notEvaluable.length,
    unresolvedTotal: missing.length + notEvaluable.length,
    omittedExpirations: report.expirations.omittedByCap,
    omittedContractsByDesign: omittedByDesign(report),
  };

  // Ranking (Section 8.1): eligible only, by the quantized lexicographic key.
  const keyOf = (c: ContractEvaluation) => ({
    score: c.score as number,
    extrinsicPctOfMid: valueOf(c.metrics.contract_extrinsic_pct_of_mid) as number,
    spreadPctOfMid: valueOf(c.metrics.contract_spread_pct_of_mid) as number,
    openInterest: valueOf(c.metrics.contract_open_interest) as number,
    dte: valueOf(c.metrics.contract_dte) as number,
    strike: c.strike as number,
    expiration: c.expiration,
    occSymbol: c.occSymbol,
  });
  const ranked = eligible.slice().sort((a, b) => compareLeapsRank(keyOf(a), keyOf(b), policy)).map((c, i) => ({ ...c, rank: i + 1 }));
  const rest = evaluated.filter((c) => c.resolution !== 'ELIGIBLE').sort((a, b) =>
    (a.expiration < b.expiration ? -1 : a.expiration > b.expiration ? 1 : 0) || (a.strike ?? 0) - (b.strike ?? 0) || (a.occSymbol < b.occSymbol ? -1 : a.occSymbol > b.occSymbol ? 1 : 0));

  const reasons: LeapsReason[] = restrictionReasons(report);
  const result = (status: LeapsContractStatus, scope: LeapsEvaluation['rankingScope'], extra: LeapsReason[]): LeapsEvaluation => ({
    symbol: input.symbol, policyVersion: policy.version, contractStatus: status, rankingScope: scope, quoteMode: window.mode, spot: acq.spot,
    acquisition: report, reasons: [...extra, ...reasons], contracts: [...ranked, ...rest], counts,
  });

  // Rule 3: any eligible contract.
  if (eligible.length > 0) {
    const complete = report.coverage === 'COMPLETE' && counts.unresolvedTotal === 0;
    return result('EVALUATED', complete ? 'COMPLETE_CHAIN' : 'EVALUATED_SUBSET', complete ? [] : [leapsReason({ code: 'LEAPS_RANKING_IS_EVALUATED_SUBSET' })]);
  }
  // Rule 4: nothing eligible and something unresolved -> a data result, never "none eligible".
  if (counts.unresolvedTotal > 0) {
    const extra: LeapsReason[] = [];
    if (counts.eligible + counts.ineligible === 0 && counts.quoteRowsMissing > 0) extra.push(leapsReason({ code: 'LEAPS_ALL_QUOTES_UNAVAILABLE', count: counts.selected }));
    if (counts.eligible + counts.ineligible === 0 && counts.quoteRowsMissing === 0) extra.push(leapsReason({ code: 'LEAPS_ALL_CONTRACTS_DATA_UNAVAILABLE', count: counts.acquiredNotEvaluable }));
    return result('DATA_UNAVAILABLE', null, [...extra, ...gateFailureCounts(evaluated)]);
  }
  // Rule 5: restricted acquisition -> the subset verdict only.
  if (report.coverage === 'RESTRICTED') {
    return result('NO_ELIGIBLE_IN_SUBSET', null, [leapsReason({ code: 'LEAPS_NO_ELIGIBLE_IN_SUBSET' }), ...gateFailureCounts(evaluated)]);
  }
  // Rule 6: complete acquisition, everything resolved, none eligible (or verified empty).
  if (report.expirations.inWindow === 0) return result('NO_SUITABLE_CONTRACT', null, [leapsReason({ code: 'LEAPS_NO_LEAPS_EXPIRATIONS' })]);
  if (counts.selected === 0) return result('NO_SUITABLE_CONTRACT', null, [leapsReason({ code: 'LEAPS_NO_CONTRACTS_IN_WINDOW' })]);
  return result('NO_SUITABLE_CONTRACT', null, [leapsReason({ code: 'LEAPS_NO_SUITABLE_CONTRACT' }), ...gateFailureCounts(evaluated)]);
}
