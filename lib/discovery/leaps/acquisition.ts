// lib/discovery/leaps/acquisition.ts

// LEAPS-QV-0001 Gate 4a -- staged, completeness-reporting acquisition of the QV LEAPS call chain (spec Sections 2, 5.2,
// 10, 11.3; rulings I1, I6, I8, I11, Q3, Q9 of revision 4).
//
// The provider is reached only through an injected `ProviderGet` (path -> { status, body }), so this module performs no
// I/O of its own, reads no clock (`nowEpochSeconds` is passed in) and stays inside the discovery isolation guard. The
// browser binding to TastyTrade (the app's same-origin proxy) is supplied by the orchestrator's caller (Gate 4c).
//
// What it guarantees:
//  * one underlying quote first; its spot (live last during the session, the regular-session close outside it, I6) is
//    the single S used for strike selection, and the raw quote is returned for the evaluator's freshness rules;
//  * expirations in the DTE window, at most `expirationCap` chosen deterministically; omissions are counted;
//  * calls with 0.40*S <= K < S only; K >= S is provably ineligible and K < 0.40*S is out of policy scope -- both
//    counted, neither a restriction;
//  * at most `maxQuoteChunksPerUnderlying` chunks: above it nothing is quoted (acquisition incomplete, never truncated);
//  * every failed chunk is counted, and its contracts are reported as missing quote rows, never dropped;
//  * HTTP 401 stops the whole run; the run budget counts every GET including retries; HTTP 429 is retried once.

import { daysFromCivil, epochDay } from '../normalized/dates';
import { marketSessionState, newYorkUtcOffsetSeconds, type MarketSessionState } from '../normalized/exchangeCalendar';
import type { QvLeapsAcquisitionPolicy } from './acquisitionPolicy';

// ---------------------------------------------------------------------------------------------------------------
// Transport and run-level budget (Q9)
// ---------------------------------------------------------------------------------------------------------------

export interface ProviderResponse {
  status: number;
  body: unknown;
}

export type ProviderGet = (path: string) => Promise<ProviderResponse>;
export type Sleep = (ms: number) => Promise<void>;

export type RunStopCode = 'AUTH_EXPIRED' | 'RUN_BUDGET_EXHAUSTED';

/** Thrown when the whole run must stop: token expired (401) or the request budget is spent. */
export class LeapsRunStop extends Error {
  readonly code: RunStopCode;
  constructor(code: RunStopCode) {
    super(code === 'AUTH_EXPIRED' ? 'TastyTrade session expired during the run.' : 'The run request budget is exhausted.');
    this.code = code;
  }
}

/** Thrown when HTTP 429 persists after the allowed retry; only the current underlying is affected. */
export class LeapsRateLimited extends Error {
  constructor() {
    super('Rate limited by the provider after the allowed retry.');
  }
}

export interface BudgetedTransport {
  get: ProviderGet;
  requestsUsed(): number;
  stopCode(): RunStopCode | null;
}

/**
 * Wraps the raw transport with the Q9 rules. Every attempt (including a 429 retry) costs one request; once the budget
 * is spent or a 401 is seen, every later call throws `LeapsRunStop` without reaching the provider.
 */
export function createBudgetedTransport(raw: ProviderGet, policy: QvLeapsAcquisitionPolicy, sleep: Sleep): BudgetedTransport {
  let used = 0;
  let stopped: RunStopCode | null = null;
  const get: ProviderGet = async (path) => {
    for (let attempt = 0; ; attempt += 1) {
      if (stopped) throw new LeapsRunStop(stopped);
      if (used >= policy.runRequestBudget) {
        stopped = 'RUN_BUDGET_EXHAUSTED';
        throw new LeapsRunStop(stopped);
      }
      used += 1;
      const response = await raw(path);
      if (response.status === 401) {
        stopped = 'AUTH_EXPIRED';
        throw new LeapsRunStop(stopped);
      }
      if (response.status === 429) {
        if (attempt < policy.rateLimitRetries) {
          await sleep(policy.rateLimitBackoffMs);
          continue;
        }
        throw new LeapsRateLimited();
      }
      return response;
    }
  };
  return { get, requestsUsed: () => used, stopCode: () => stopped };
}

// ---------------------------------------------------------------------------------------------------------------
// Output shapes (spec Section 2, revision 4 units)
// ---------------------------------------------------------------------------------------------------------------

export type AcquisitionCoverage = 'COMPLETE' | 'RESTRICTED' | 'FAILED';

export type AcquisitionRestriction =
  | { kind: 'EXPIRATION_CAP'; limit: number; omittedExpirations: number; omittedContracts: number | null }
  | { kind: 'QUOTE_LIMIT'; limit: number; omittedContracts: number }
  | { kind: 'CHUNK_FAILURE'; failedChunks: number; contractsInFailedChunks: number }
  /** A selected expiration came without a strike list: its contracts are unknown, so coverage cannot be complete. */
  | { kind: 'STRIKES_UNAVAILABLE'; expirations: number };

export interface AcquisitionReport {
  coverage: AcquisitionCoverage;
  failure?: string;
  /** Expiration counts. */
  expirations: { inWindow: number; selected: number; omittedByCap: number };
  /** Contract counts (calls), except `quoteChunksFailed` which counts requests. */
  contracts: {
    candidatesInSelectedExpirations: number;
    excludedProvablyIneligible: number;
    excludedOutOfPolicyBand: number;
    excludedNonStandardRoot: number;
    selectedForQuote: number;
    omittedByQuoteLimit: number;
    omittedInOmittedExpirations: number | null;
    quoteChunksFailed: number;
    quoteRowsMissing: number;
    quoteRowsReceived: number;
  };
  /** True when the per-underlying quote limit was exceeded: nothing was quoted and nothing may be ranked (Q3). */
  quoteLimitExceeded: boolean;
  restrictions: AcquisitionRestriction[];
}

/** Instrument evidence copied from the nested-chain item the contract belongs to (4.4, I8); judged by the evaluator. */
export interface RawInstrumentEvidence {
  rootSymbol: unknown;
  underlyingSymbol: unknown;
  optionChainType: unknown;
  sharesPerContract: unknown;
  deliverables: unknown;
}

export interface RawLeapsContract {
  occSymbol: string;
  expiration: string;
  /** Calendar days from the New York date of `now` to expiration. */
  dte: number;
  strike: number | null;
  optionType: 'C';
  instrument: RawInstrumentEvidence;
  /** The provider's market-data row, fields copied as returned (strings mostly); null when no usable row arrived. */
  quote: Record<string, unknown> | null;
  /** The OCC symbol appears more than once in the nested chain (spec 5.1 rule 5: the evaluator keeps none). */
  duplicateInChain: boolean;
  /** The provider returned more than one row for this symbol; the row is not used. */
  duplicateQuoteRows: boolean;
}

export interface LeapsChainSnapshot {
  provider: 'tastytrade';
  acquisition: AcquisitionReport;
  contracts: RawLeapsContract[];
}

export interface RawUnderlyingQuote {
  symbol: string;
  fields: Record<string, unknown>;
}

export type LeapsAcquisitionStatus =
  | 'ACQUIRED'
  | 'UNDERLYING_QUOTE_UNAVAILABLE'
  | 'CHAIN_FAILED'
  | 'NOT_EVALUATED_RUN_CAP'
  | 'AUTH_EXPIRED';

export interface LeapsChainAcquisition {
  symbol: string;
  status: LeapsAcquisitionStatus;
  /** Result-level reason code (spec 5.4) when not ACQUIRED. */
  reason: string | null;
  sessionState: MarketSessionState | null;
  underlying: RawUnderlyingQuote | null;
  /** The single S used for strike selection (and for evaluation, Section 10 stage 1). */
  spot: { price: number; basis: 'LAST' | 'REGULAR_SESSION_CLOSE' } | null;
  chain: LeapsChainSnapshot | null;
}

// ---------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------

const QUOTE_FIELDS = [
  'symbol', 'bid', 'ask', 'mid', 'mark', 'last', 'close', 'prev-close', 'bid-size', 'ask-size', 'delta', 'gamma', 'theta',
  'vega', 'rho', 'volatility', 'open-interest', 'volume', 'updated-at', 'is-trading-halted', 'theo-price',
];
const UNDERLYING_FIELDS = ['symbol', 'last', 'close', 'close-price-type', 'prev-close', 'bid', 'ask', 'mark', 'mid', 'updated-at', 'summary-date'];
const DELIVERABLE_FIELDS = ['amount', 'deliverable-type', 'symbol', 'instrument-type', 'percent', 'root-symbol', 'description'];

function positiveNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function pick(record: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  fields.forEach((f) => {
    if (record[f] !== undefined) out[f] = record[f];
  });
  return out;
}

function itemsOf(body: unknown): unknown[] | null {
  const data = (body as { data?: { items?: unknown } } | null)?.data;
  return data && Array.isArray(data.items) ? data.items : null;
}

const normalizeSymbol = (s: string) => s.replace(/\s+/g, '');

/** New York calendar date of `nowEpochSeconds`, as an epoch day. */
function newYorkEpochDay(nowEpochSeconds: number): number {
  const utcDay = epochDay(nowEpochSeconds);
  return epochDay(nowEpochSeconds + newYorkUtcOffsetSeconds(utcDay));
}

function epochDayOfIsoDate(date: unknown): number | null {
  if (typeof date !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  return daysFromCivil(Number(m[1]), Number(m[2]), Number(m[3]));
}

function sanitizeDeliverables(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw === undefined ? null : raw;
  return raw.map((d) => (d && typeof d === 'object' ? pick(d as Record<string, unknown>, DELIVERABLE_FIELDS) : d));
}

function emptyReport(coverage: AcquisitionCoverage, failure?: string): AcquisitionReport {
  return {
    coverage,
    ...(failure ? { failure } : {}),
    expirations: { inWindow: 0, selected: 0, omittedByCap: 0 },
    contracts: {
      candidatesInSelectedExpirations: 0, excludedProvablyIneligible: 0, excludedOutOfPolicyBand: 0, excludedNonStandardRoot: 0,
      selectedForQuote: 0, omittedByQuoteLimit: 0, omittedInOmittedExpirations: 0, quoteChunksFailed: 0, quoteRowsMissing: 0,
      quoteRowsReceived: 0,
    },
    quoteLimitExceeded: false,
    restrictions: [],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// One underlying
// ---------------------------------------------------------------------------------------------------------------

interface ExpirationCalls {
  date: string;
  dte: number;
  /** null when the expiration carries no strike list (contract counts then unknown). */
  calls: { occ: string; strike: number | null; instrument: RawInstrumentEvidence }[] | null;
}

/**
 * Acquires one underlying. A `LeapsRunStop` propagates (the run stops); every other failure is contained here and
 * returned as a status, so one underlying can never affect another.
 */
export async function acquireLeapsChain(
  symbol: string,
  get: ProviderGet,
  nowEpochSeconds: number,
  policy: QvLeapsAcquisitionPolicy,
): Promise<LeapsChainAcquisition> {
  const sessionState = marketSessionState(nowEpochSeconds);
  const base = { symbol, sessionState, underlying: null, spot: null, chain: null };
  try {
    // Stage 1: the underlying quote, once, first.
    const quoteResponse = await get(`/market-data/by-type?equity=${encodeURIComponent(symbol)}`);
    const quoteItems = quoteResponse.status >= 200 && quoteResponse.status < 300 ? itemsOf(quoteResponse.body) : null;
    const quoteRecord = (quoteItems ?? []).find(
      (it) => it && typeof it === 'object' && normalizeSymbol(String((it as Record<string, unknown>).symbol ?? '')) === normalizeSymbol(symbol),
    ) as Record<string, unknown> | undefined;
    const underlying: RawUnderlyingQuote | null = quoteRecord ? { symbol, fields: pick(quoteRecord, UNDERLYING_FIELDS) } : null;
    // I6: during the session S is the live last; outside it, the regular-session close (after-hours prints never move S).
    const spotPrice = !underlying || sessionState === null
      ? null
      : sessionState === 'REGULAR_HOURS' ? positiveNumber(underlying.fields.last) : positiveNumber(underlying.fields.close);
    if (spotPrice === null) {
      return { ...base, underlying, status: 'UNDERLYING_QUOTE_UNAVAILABLE', reason: 'LEAPS_UNDERLYING_QUOTE_UNAVAILABLE' };
    }
    const spot = { price: spotPrice, basis: sessionState === 'REGULAR_HOURS' ? 'LAST' as const : 'REGULAR_SESSION_CLOSE' as const };

    // Stage 2: the nested chain.
    const chainResponse = await get(`/option-chains/${encodeURIComponent(symbol)}/nested`);
    if (chainResponse.status < 200 || chainResponse.status >= 300) {
      const failure = `LEAPS_CHAIN_PROVIDER_FAILURE:HTTP_${chainResponse.status}`;
      return { ...base, underlying, spot, status: 'CHAIN_FAILED', reason: failure, chain: { provider: 'tastytrade', acquisition: emptyReport('FAILED', failure), contracts: [] } };
    }
    const chainItems = itemsOf(chainResponse.body);
    if (!chainItems) {
      const failure = 'LEAPS_CHAIN_PROVIDER_FAILURE:UNPARSEABLE';
      return { ...base, underlying, spot, status: 'CHAIN_FAILED', reason: failure, chain: { provider: 'tastytrade', acquisition: emptyReport('FAILED', failure), contracts: [] } };
    }

    const today = newYorkEpochDay(nowEpochSeconds);
    const byDate: Record<string, ExpirationCalls> = {};
    let excludedNonStandardRoot = 0;
    chainItems.forEach((rawItem) => {
      if (!rawItem || typeof rawItem !== 'object') return;
      const item = rawItem as Record<string, unknown>;
      const instrument: RawInstrumentEvidence = {
        rootSymbol: item['root-symbol'] ?? null,
        underlyingSymbol: item['underlying-symbol'] ?? null,
        optionChainType: item['option-chain-type'] ?? null,
        sharesPerContract: item['shares-per-contract'] ?? null,
        deliverables: sanitizeDeliverables(item.deliverables),
      };
      // I8: an explicitly non-standard chain (adjusted root) is refused in v1; its calls are counted, not quoted.
      const nonStandard = typeof item['option-chain-type'] === 'string' && item['option-chain-type'] !== 'Standard';
      const expirations = Array.isArray(item.expirations) ? item.expirations : [];
      expirations.forEach((rawExp) => {
        if (!rawExp || typeof rawExp !== 'object') return;
        const exp = rawExp as Record<string, unknown>;
        const date = exp['expiration-date'];
        const day = epochDayOfIsoDate(date);
        if (day === null || typeof date !== 'string') return;
        const dte = day - today;
        if (dte < policy.dteMin || dte > policy.dteMax) return;
        const strikes = Array.isArray(exp.strikes) ? exp.strikes : null;
        if (nonStandard) {
          excludedNonStandardRoot += (strikes ?? []).filter((s) => s && typeof (s as Record<string, unknown>).call === 'string').length;
          return;
        }
        const entry = byDate[date] ?? (byDate[date] = { date, dte, calls: [] });
        if (strikes === null) {
          entry.calls = null;
          return;
        }
        strikes.forEach((rawStrike) => {
          const strike = rawStrike as Record<string, unknown> | null;
          if (!strike || typeof strike.call !== 'string' || strike.call === '') return;
          entry.calls?.push({ occ: strike.call, strike: positiveNumber(strike['strike-price']), instrument });
        });
      });
    });

    // Stage 2 (cont.): expiration cap, deterministic: |DTE - target| ascending, ties earlier expiration first.
    const inWindow = Object.keys(byDate).map((d) => byDate[d]).sort((a, b) =>
      Math.abs(a.dte - policy.expirationPriorityTargetDte) - Math.abs(b.dte - policy.expirationPriorityTargetDte) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const selectedExpirations = inWindow.slice(0, policy.expirationCap);
    const omittedExpirations = inWindow.slice(policy.expirationCap);

    // Stage 3: strikes, calls only. K >= S provably ineligible; K < band*S out of policy scope; unparseable strike kept
    // as a candidate (the evaluator resolves it as DATA_UNAVAILABLE rather than it vanishing).
    const bandLow = policy.strikeBandLowFractionOfSpot * spotPrice;
    const classify = (k: number | null): 'CANDIDATE' | 'AT_OR_ABOVE_SPOT' | 'BELOW_BAND' =>
      k === null ? 'CANDIDATE' : k >= spotPrice ? 'AT_OR_ABOVE_SPOT' : k < bandLow ? 'BELOW_BAND' : 'CANDIDATE';
    let excludedProvablyIneligible = 0;
    let excludedOutOfPolicyBand = 0;
    const candidates: { occ: string; strike: number | null; date: string; dte: number; instrument: RawInstrumentEvidence }[] = [];
    let expirationsWithoutStrikes = 0;
    selectedExpirations.forEach((exp) => {
      if (exp.calls === null) {
        expirationsWithoutStrikes += 1;
        return;
      }
      exp.calls.forEach((c) => {
        const cls = classify(c.strike);
        if (cls === 'AT_OR_ABOVE_SPOT') excludedProvablyIneligible += 1;
        else if (cls === 'BELOW_BAND') excludedOutOfPolicyBand += 1;
        else candidates.push({ occ: c.occ, strike: c.strike, date: exp.date, dte: exp.dte, instrument: c.instrument });
      });
    });
    let omittedInOmittedExpirations: number | null = 0;
    omittedExpirations.forEach((exp) => {
      if (exp.calls === null || omittedInOmittedExpirations === null) {
        omittedInOmittedExpirations = null;
        return;
      }
      omittedInOmittedExpirations += exp.calls.filter((c) => classify(c.strike) === 'CANDIDATE').length;
    });

    const report = emptyReport('COMPLETE');
    report.expirations = { inWindow: inWindow.length, selected: selectedExpirations.length, omittedByCap: omittedExpirations.length };
    report.contracts.excludedProvablyIneligible = excludedProvablyIneligible;
    report.contracts.excludedOutOfPolicyBand = excludedOutOfPolicyBand;
    report.contracts.excludedNonStandardRoot = excludedNonStandardRoot;
    report.contracts.candidatesInSelectedExpirations = candidates.length;
    report.contracts.omittedInOmittedExpirations = omittedInOmittedExpirations;
    if (omittedExpirations.length > 0) {
      report.restrictions.push({ kind: 'EXPIRATION_CAP', limit: policy.expirationCap, omittedExpirations: omittedExpirations.length, omittedContracts: omittedInOmittedExpirations });
    }
    if (expirationsWithoutStrikes > 0) report.restrictions.push({ kind: 'STRIKES_UNAVAILABLE', expirations: expirationsWithoutStrikes });

    // Deterministic order: expiration priority, then strike ascending, then OCC symbol.
    const priority: Record<string, number> = {};
    selectedExpirations.forEach((e, i) => { priority[e.date] = i; });
    candidates.sort((a, b) => priority[a.date] - priority[b.date]
      || (a.strike ?? Number.POSITIVE_INFINITY) - (b.strike ?? Number.POSITIVE_INFINITY)
      || (a.occ < b.occ ? -1 : a.occ > b.occ ? 1 : 0));

    const seenOcc: Record<string, number> = {};
    candidates.forEach((c) => { seenOcc[normalizeSymbol(c.occ)] = (seenOcc[normalizeSymbol(c.occ)] ?? 0) + 1; });
    const uniqueSymbols: string[] = [];
    const added: Record<string, true> = {};
    candidates.forEach((c) => {
      const key = normalizeSymbol(c.occ);
      if (!added[key]) { added[key] = true; uniqueSymbols.push(c.occ); }
    });

    // Stage 4: per-underlying quote limit. Over it: nothing is quoted, nothing is ranked (never truncated).
    const limit = policy.quoteChunkSize * policy.maxQuoteChunksPerUnderlying;
    if (uniqueSymbols.length > limit) {
      report.quoteLimitExceeded = true;
      report.contracts.omittedByQuoteLimit = candidates.length;
      report.restrictions.push({ kind: 'QUOTE_LIMIT', limit, omittedContracts: candidates.length });
      report.coverage = 'RESTRICTED';
      return { ...base, underlying, spot, status: 'ACQUIRED', reason: null, chain: { provider: 'tastytrade', acquisition: report, contracts: [] } };
    }

    // Stage 5: quotes in chunks; a failed chunk is counted, its contracts become missing rows.
    const rows: Record<string, Record<string, unknown>[]> = {};
    let failedChunks = 0;
    let contractsInFailedChunks = 0;
    for (let start = 0; start < uniqueSymbols.length; start += policy.quoteChunkSize) {
      const chunk = uniqueSymbols.slice(start, start + policy.quoteChunkSize);
      const path = `/market-data/by-type?${chunk.map((s) => `equity-option=${encodeURIComponent(s)}`).join('&')}`;
      let chunkItems: unknown[] | null = null;
      try {
        const response = await get(path);
        chunkItems = response.status >= 200 && response.status < 300 ? itemsOf(response.body) : null;
      } catch (error) {
        if (error instanceof LeapsRunStop || error instanceof LeapsRateLimited) throw error;
        chunkItems = null;
      }
      if (!chunkItems) {
        failedChunks += 1;
        contractsInFailedChunks += candidates.filter((c) => chunk.some((s) => normalizeSymbol(s) === normalizeSymbol(c.occ))).length;
        continue;
      }
      chunkItems.forEach((rawRow) => {
        if (!rawRow || typeof rawRow !== 'object') return;
        const row = rawRow as Record<string, unknown>;
        if (typeof row.symbol !== 'string') return;
        const key = normalizeSymbol(row.symbol);
        (rows[key] ?? (rows[key] = [])).push(pick(row, QUOTE_FIELDS));
      });
    }

    const contracts: RawLeapsContract[] = candidates.map((c) => {
      const key = normalizeSymbol(c.occ);
      const found = rows[key] ?? [];
      return {
        occSymbol: c.occ,
        expiration: c.date,
        dte: c.dte,
        strike: c.strike,
        optionType: 'C',
        instrument: c.instrument,
        quote: found.length === 1 ? found[0] : null,
        duplicateInChain: (seenOcc[key] ?? 0) > 1,
        duplicateQuoteRows: found.length > 1,
      };
    });
    report.contracts.selectedForQuote = contracts.length;
    report.contracts.quoteRowsReceived = contracts.filter((c) => c.quote !== null).length;
    report.contracts.quoteRowsMissing = contracts.length - report.contracts.quoteRowsReceived;
    report.contracts.quoteChunksFailed = failedChunks;
    if (failedChunks > 0) report.restrictions.push({ kind: 'CHUNK_FAILURE', failedChunks, contractsInFailedChunks });
    report.coverage = report.restrictions.length > 0 ? 'RESTRICTED' : 'COMPLETE';
    return { ...base, underlying, spot, status: 'ACQUIRED', reason: null, chain: { provider: 'tastytrade', acquisition: report, contracts } };
  } catch (error) {
    if (error instanceof LeapsRunStop) throw error;
    if (error instanceof LeapsRateLimited) {
      return { ...base, status: 'NOT_EVALUATED_RUN_CAP', reason: 'LEAPS_NOT_EVALUATED_RUN_CAP' };
    }
    return { ...base, status: 'CHAIN_FAILED', reason: 'LEAPS_CHAIN_PROVIDER_FAILURE:NETWORK' };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// One run (11.3, Q9)
// ---------------------------------------------------------------------------------------------------------------

export interface LeapsRunResult {
  results: LeapsChainAcquisition[];
  requestsUsed: number;
  stopped: RunStopCode | null;
}

const TIMED_OUT = Symbol('timed-out');

/**
 * Acquires every symbol (already filtered to Gate 3 SETUP/ACTIONABLE by the caller), in input order, with at most
 * `concurrency` in flight. Beyond `maxUnderlyingsPerRun`, or once the run stops, a symbol is reported as not evaluated
 * (never as unsuitable) and costs no request. A run stop also voids any underlying still in flight: a partial ladder is
 * never returned.
 */
export async function acquireLeapsRun(
  symbols: readonly string[],
  deps: { get: ProviderGet; nowEpochSeconds: number; sleep: Sleep },
  policy: QvLeapsAcquisitionPolicy,
): Promise<LeapsRunResult> {
  const transport = createBudgetedTransport(deps.get, policy, deps.sleep);
  const results: LeapsChainAcquisition[] = new Array(symbols.length);
  const sessionState = marketSessionState(deps.nowEpochSeconds);
  const notEvaluated = (symbol: string, stop: RunStopCode | null): LeapsChainAcquisition => ({
    symbol, sessionState, underlying: null, spot: null, chain: null,
    status: stop === 'AUTH_EXPIRED' ? 'AUTH_EXPIRED' : 'NOT_EVALUATED_RUN_CAP',
    reason: stop === 'AUTH_EXPIRED' ? 'LEAPS_AUTH_EXPIRED' : 'LEAPS_NOT_EVALUATED_RUN_CAP',
  });

  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= symbols.length) return;
      const symbol = symbols[index];
      if (index >= policy.maxUnderlyingsPerRun || transport.stopCode()) {
        results[index] = notEvaluated(symbol, transport.stopCode());
        continue;
      }
      try {
        const outcome = await Promise.race([
          acquireLeapsChain(symbol, transport.get, deps.nowEpochSeconds, policy),
          deps.sleep(policy.perUnderlyingTimeoutMs).then(() => TIMED_OUT),
        ]);
        results[index] = outcome === TIMED_OUT
          ? { symbol, sessionState, underlying: null, spot: null, chain: null, status: 'CHAIN_FAILED', reason: 'LEAPS_CHAIN_PROVIDER_FAILURE:TIMEOUT' }
          : outcome as LeapsChainAcquisition;
      } catch (error) {
        results[index] = notEvaluated(symbol, error instanceof LeapsRunStop ? error.code : null);
      }
    }
  };
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.max(1, policy.concurrency); i += 1) workers.push(worker());
  await Promise.all(workers);

  // A 401 or an exhausted budget makes every later request throw, so an underlying still in flight ends as not
  // evaluated (above) rather than with a partial ladder (Q9).
  return { results, requestsUsed: transport.requestsUsed(), stopped: transport.stopCode() };
}
