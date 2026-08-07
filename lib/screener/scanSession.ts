// lib/screener/scanSession.ts
//
// SCREENER-RESULTS-0001 — canonical scan-session model, revised per fourth
// (final enforcement) round of review.
//
// This module is pure and framework-free — no React, no I/O. app/screener/
// page.tsx owns the single "active session" React state; this module owns
// the shape and the small set of validated operations that can transition
// it.
//
// ── CORE INVARIANT ─────────────────────────────────────────────────────
// Every normalized `selectedSymbols` entry has EXACTLY ONE terminal outcome
// once a session reaches 'complete', 'error', or 'stopped'. No selected
// symbol may ever disappear silently.
//
// ── SELECTED vs PLANNED ──────────────────────────────────────────────────
// `selectedSymbols` is the trader's OWN selection — the Opportunity
// Universe, unchanged — UNLESS the explicit "Scan all eligible holdings"
// override is set, in which case selectedSymbols becomes the full
// verified-eligible set. An EMPTY universe is never treated as an implicit
// override: empty universe + no override = zero selected, zero planned.
// The override must be an explicit trader choice; the model never infers
// it. `plannedScanSymbols` is the eligible subset of selectedSymbols that
// is actually scheduled to be scanned. A selected-but-not-planned symbol
// gets an IMMEDIATE 'skipped' outcome at session construction. See
// `resolveScanPlan()`.
//
// ── MODE / STRATEGY COMPATIBILITY ────────────────────────────────────────
// Only combinations that correspond to real production workflows are
// permitted: 'spreads' may use any mode; 'csp'/'cc'/'pmcc' are Filtered
// only. This is enforced at construction (throws
// `ScanSessionConstructionError`) and at cache validation
// (`INVALID_MODE_STRATEGY_COMBINATION`). This ticket does not add new
// Ranked/Targeted workflows for csp/cc/pmcc — if one is ever built, this
// compatibility table is where it gets added.
//
// ── EVALUATED-WITH-ZERO-CANDIDATES REQUIRES A REASON ─────────────────────
// `recordSymbolEvaluated(session, symbol, [])` — zero results — REQUIRES an
// explicit reasonCode from `EVALUATED_ZERO_CANDIDATE_REASON_CODES`. A
// symbol can never be silently "evaluated into nothing" with no
// explanation. Conversely, a reasonCode is invalid when real candidates
// were produced. `NO_OPTION_CHAIN_RETURNED` is NOT a valid evaluated
// reason — failing to acquire a chain at all is a market/acquisition
// failure, recorded via `recordSymbolFailed()`, never a completed
// evaluation.
//
// ── PER-SYMBOL SCOPE-EXCLUSION REASONS ───────────────────────────────────
// `createScanSession`'s `scopeExclusionReasonCode` argument accepts either
// a single fallback `ScreenerReasonCode` or a `(symbol) => ScreenerReasonCode`
// resolver, so a caller with per-symbol detail (e.g. Covered Call's capacity
// report distinguishing "no shares owned" from "fully covered" from "hidden
// by the trader") can supply the precise reason for each excluded symbol
// rather than one blanket code for all of them. `CC_UNATTRIBUTABLE_EXPOSURE`
// must NEVER be produced by this resolver — it is reserved exclusively for
// `errorSession()`'s account-wide fail-closed path; conflating it with an
// ordinary per-symbol exclusion would misrepresent a global data-integrity
// failure as a routine capacity gap.
//
// ── HOW THE ONLY LEGAL MUTATIONS HAPPEN ─────────────────────────────────
// page.tsx must NEVER touch `symbolOutcomes` or `results` directly.
// `recordSymbolEvaluated()`/`recordSymbolFailed()` operate ONLY on
// `plannedScanSymbols` members. `recordSymbolSkipped()` may operate on any
// selected symbol.
//
// ── ON THE "STRUCTURAL IMPOSSIBILITY" CLAIM (still corrected, not restored) ──
// `recordSymbolEvaluated()` accepts any `ScreenResult[]` its caller
// supplies. This module cannot prevent a caller from passing a synthetic
// error stand-in. The real enforcement boundary is a call-site discipline
// requirement for the (not yet done) page.tsx wiring phase: every catch
// block must call `recordSymbolFailed()` directly and never fabricate a
// `ScreenResult`. No shape-based predicate is implemented — one cannot
// reliably distinguish a legitimate zero-candidate evaluation from a
// synthetic error object by shape alone.
//
// ── WHAT CACHE VALIDATION DOES AND DOES NOT ESTABLISH ─────────────────────
// `validateSessionData()` establishes SESSION-LEVEL integrity: symbol
// membership, per-symbol candidate-count reconciliation, strategy-tag
// legitimacy, and the minimum critical `ScreenResult` fields needed to
// trust the cache (`symbol`, `strategy`, `qualified` as boolean,
// `failReasons` as an array). It does NOT deeply validate every nested
// `ScreenResult` field (`bestCandidate`, `checks`, etc.) — a restored
// result should not be treated as a fully re-verified `ScreenResult` beyond
// those checks.
//
// ── STALE-RESPONSE GUARD ────────────────────────────────────────────────
// See `isSessionStale()` / `shouldGenerateRecommendationsForSession()`. The
// full guarantee (a stale response can never publish through
// RecommendationService) requires page.tsx wiring that does not exist yet.

import type { ScreenResult } from '@/lib/scans/types';

export type ScreenerScanMode = 'filter' | 'rank' | 'targeted';

// 'cc', not 'covered_call' — matches ScreenResult.strategy/ScreenerJobKind
// elsewhere in the codebase exactly.
export type ScreenerRequestedStrategy = 'spreads' | 'csp' | 'cc' | 'pmcc';

export type ScreenerSessionStatus = 'running' | 'complete' | 'error' | 'stopped';

// Stable, canonical reason codes. Human-readable text is derived from these
// via REASON_CODE_LABELS — never store or compare free-text reason strings.
export type ScreenerReasonCode =
  | 'NO_VALID_EXPIRATION'
  | 'NO_OPTION_CHAIN_RETURNED'
  | 'NO_QUALIFYING_CANDIDATE'
  | 'UNSUPPORTED_CANDIDATE_STRUCTURE'
  | 'MARKET_DATA_REQUEST_FAILED'
  | 'EXCLUDED_BY_SCAN_SCOPE'
  | 'CC_NO_CAPACITY'
  | 'CC_NO_SHARES_OWNED'
  | 'CC_FULLY_COVERED'
  | 'CC_HIDDEN_BY_TRADER'
  | 'CC_HOLDINGS_UNAVAILABLE'
  | 'CC_UNATTRIBUTABLE_EXPOSURE'
  | 'ACCESS_TOKEN_UNAVAILABLE'
  | 'CANCELLED'
  | 'SUPERSEDED'
  | 'UNKNOWN_ERROR';

export const REASON_CODE_LABELS: Record<ScreenerReasonCode, string> = {
  NO_VALID_EXPIRATION: 'No valid expiration',
  NO_OPTION_CHAIN_RETURNED: 'No option chain returned',
  NO_QUALIFYING_CANDIDATE: 'No qualifying candidate generated',
  UNSUPPORTED_CANDIDATE_STRUCTURE: 'Unsupported candidate structure',
  MARKET_DATA_REQUEST_FAILED: 'Market-data request failed',
  EXCLUDED_BY_SCAN_SCOPE: 'Excluded by the requested scan scope',
  CC_NO_CAPACITY: 'No available covered-call capacity',
  CC_NO_SHARES_OWNED: 'No shares owned for this symbol',
  CC_FULLY_COVERED: 'Fully covered by existing short calls or working orders',
  CC_HIDDEN_BY_TRADER: 'Hidden by the trader from this scan',
  CC_HOLDINGS_UNAVAILABLE: 'Holdings or working-order data unavailable',
  CC_UNATTRIBUTABLE_EXPOSURE: 'Unattributable exposure — account-wide covered-call data could not be verified',
  ACCESS_TOKEN_UNAVAILABLE: 'Could not authenticate this scan',
  CANCELLED: 'Cancelled by the trader',
  SUPERSEDED: 'Superseded by a newer scan',
  UNKNOWN_ERROR: 'Unknown error',
};

// Reason codes valid on an 'evaluated' outcome with candidateCount 0 — these
// describe "evaluation completed normally, zero candidates resulted," never
// a failure to complete. NO_OPTION_CHAIN_RETURNED is deliberately excluded:
// failing to acquire a chain at all means evaluation never really happened —
// that belongs on a 'failed' outcome.
const EVALUATED_ZERO_CANDIDATE_REASON_CODES: ReadonlySet<ScreenerReasonCode> = new Set<ScreenerReasonCode>([
  'NO_VALID_EXPIRATION',
  'NO_QUALIFYING_CANDIDATE',
  'UNSUPPORTED_CANDIDATE_STRUCTURE',
]);

const VALID_REASON_CODES = new Set<string>(Object.keys(REASON_CODE_LABELS));
const VALID_STRATEGIES = new Set<string>(['spreads', 'csp', 'cc', 'pmcc']);
const VALID_MODES = new Set<string>(['filter', 'rank', 'targeted']);
const VALID_STATUSES = new Set<string>(['running', 'complete', 'error', 'stopped']);
const VALID_OUTCOME_STATUSES = new Set<string>(['evaluated', 'failed', 'skipped']);
const VALID_CACHE_PROVENANCE = new Set<string>(['live', 'idb-cache']);

// Which real ScreenResult.strategy values are legitimate for each requested
// strategy. 'spreads' permits the three spread subtypes it actually
// produces; every other requested strategy permits exactly its own tag.
const STRATEGY_RESULT_TYPES: Record<ScreenerRequestedStrategy, ReadonlySet<string>> = {
  spreads: new Set(['BPS', 'BCS', 'IC']),
  csp: new Set(['CSP']),
  cc: new Set(['CC']),
  pmcc: new Set(['PMCC']),
};

// Only combinations matching real production workflows. Does not add new
// Ranked/Targeted workflows for csp/cc/pmcc — see module header.
const STRATEGY_ALLOWED_MODES: Record<ScreenerRequestedStrategy, ReadonlySet<ScreenerScanMode>> = {
  spreads: new Set<ScreenerScanMode>(['filter', 'rank', 'targeted']),
  csp: new Set<ScreenerScanMode>(['filter']),
  cc: new Set<ScreenerScanMode>(['filter']),
  pmcc: new Set<ScreenerScanMode>(['filter']),
};

// Reason codes valid for a CONSTRUCTION-TIME scope exclusion (a selected
// symbol that is not part of the plan). Deliberately excludes every global-
// failure reason (CC_UNATTRIBUTABLE_EXPOSURE, CC_HOLDINGS_UNAVAILABLE,
// ACCESS_TOKEN_UNAVAILABLE, NO_OPTION_CHAIN_RETURNED,
// MARKET_DATA_REQUEST_FAILED) and every stop-transition reason (CANCELLED,
// SUPERSEDED) — those describe an ATTEMPT that failed or was interrupted,
// never an eligibility decision made before any attempt was made.
const ALLOWED_SCOPE_EXCLUSION_REASON_CODES: ReadonlySet<ScreenerReasonCode> = new Set<ScreenerReasonCode>([
  'EXCLUDED_BY_SCAN_SCOPE',
  'CC_NO_CAPACITY',
  'CC_NO_SHARES_OWNED',
  'CC_FULLY_COVERED',
  'CC_HIDDEN_BY_TRADER',
]);

const SCHEMA_VERSION = 3 as const;

// ── Symbol normalization ────────────────────────────────────────────────
export function normalizeSymbols(symbols: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of symbols) {
    const sym = (raw ?? '').trim().toUpperCase();
    if (sym.length === 0) continue;
    if (seen.has(sym)) continue;
    seen.add(sym);
    out.push(sym);
  }
  return out;
}

function isNormalizedSymbolArray(list: unknown): list is string[] {
  if (!Array.isArray(list)) return false;
  if (!list.every(s => typeof s === 'string')) return false;
  const strs = list as string[];
  if (strs.some(s => s.length === 0 || s !== s.trim().toUpperCase())) return false;
  return new Set(strs).size === strs.length;
}

// ── Scope and scan-plan resolution ──────────────────────────────────────
export interface ScreenerScanScope {
  universeSymbols: string[];
  eligibleSymbols: string[];
  universeOverridden?: boolean;
}

export interface ScreenerScanPlan {
  selectedSymbols: string[];
  plannedScanSymbols: string[];
}

// Resolves selectedSymbols and plannedScanSymbols from scope.
//   - Override: selected = planned = the full verified-eligible set.
//   - Ordinary case (including an EMPTY universe, which is NOT an implicit
//     override): selected = the trader's universe unchanged; planned = the
//     intersection with eligible. An empty universe therefore yields zero
//     selected and zero planned unless the override is explicitly set.
export function resolveScanPlan(scope: ScreenerScanScope): ScreenerScanPlan {
  const universe = normalizeSymbols(scope.universeSymbols);
  const eligible = normalizeSymbols(scope.eligibleSymbols);

  if (scope.universeOverridden) {
    return { selectedSymbols: eligible, plannedScanSymbols: eligible };
  }

  const eligibleSet = new Set(eligible);
  return { selectedSymbols: universe, plannedScanSymbols: universe.filter(sym => eligibleSet.has(sym)) };
}

// ── Per-symbol outcome ───────────────────────────────────────────────────
export type ScreenerSymbolOutcomeStatus = 'evaluated' | 'failed' | 'skipped';

export interface ScreenerSymbolOutcome {
  symbol: string;
  status: ScreenerSymbolOutcomeStatus;
  // Required for 'failed'/'skipped'. For 'evaluated': REQUIRED when
  // candidateCount is 0 (must be one of EVALUATED_ZERO_CANDIDATE_REASON_CODES),
  // and FORBIDDEN when candidateCount > 0.
  reasonCode?: ScreenerReasonCode;
  candidateCount: number;
}

export interface ScreenerScanSession {
  sessionId: string;
  mode: ScreenerScanMode;
  requestedStrategy: ScreenerRequestedStrategy;
  scope: ScreenerScanScope;
  selectedSymbols: string[];
  plannedScanSymbols: string[];
  startedAt: number;
  completedAt: number | null;
  status: ScreenerSessionStatus;
  symbolOutcomes: ScreenerSymbolOutcome[];
  results: ScreenResult[];
  cacheProvenance: 'live' | 'idb-cache';
  cachedAt: number | null;
  schemaVersion: typeof SCHEMA_VERSION;
}

// ── Construction ─────────────────────────────────────────────────────────

export class ScanSessionConstructionError extends Error {}

export function createScanSessionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createScanSession(args: {
  mode: ScreenerScanMode;
  requestedStrategy: ScreenerRequestedStrategy;
  scope: ScreenerScanScope;
  // Single fallback code, OR a per-symbol resolver for precise exclusion
  // reasons (e.g. Covered Call distinguishing no-shares vs fully-covered vs
  // hidden-by-trader). Defaults to 'EXCLUDED_BY_SCAN_SCOPE' when omitted.
  // Every resolved code MUST be in ALLOWED_SCOPE_EXCLUSION_REASON_CODES —
  // anything else (including CC_UNATTRIBUTABLE_EXPOSURE,
  // ACCESS_TOKEN_UNAVAILABLE, CANCELLED, SUPERSEDED, etc.) throws
  // ScanSessionConstructionError BEFORE any session object is built.
  scopeExclusionReasonCode?: ScreenerReasonCode | ((symbol: string) => ScreenerReasonCode);
}): ScreenerScanSession {
  if (!STRATEGY_ALLOWED_MODES[args.requestedStrategy].has(args.mode)) {
    throw new ScanSessionConstructionError(
      `createScanSession: mode '${args.mode}' is not a valid production workflow for strategy '${args.requestedStrategy}'.`
    );
  }

  const plan = resolveScanPlan(args.scope);
  const resolveExclusionReason = (symbol: string): ScreenerReasonCode => {
    if (typeof args.scopeExclusionReasonCode === 'function') return args.scopeExclusionReasonCode(symbol);
    return args.scopeExclusionReasonCode ?? 'EXCLUDED_BY_SCAN_SCOPE';
  };

  // Resolve and validate EVERY exclusion reason up front, before building
  // any part of the session — a single invalid resolved reason must never
  // leave a partially initialized session behind.
  const plannedSet = new Set(plan.plannedScanSymbols);
  const exclusions: Array<{ symbol: string; reasonCode: ScreenerReasonCode }> = [];
  for (const symbol of plan.selectedSymbols) {
    if (plannedSet.has(symbol)) continue;
    const reasonCode = resolveExclusionReason(symbol);
    if (!ALLOWED_SCOPE_EXCLUSION_REASON_CODES.has(reasonCode)) {
      throw new ScanSessionConstructionError(
        `createScanSession: scopeExclusionReasonCode resolved to '${reasonCode}' for '${symbol}', which is not a valid ` +
        `construction-time scope-exclusion reason. Global-failure reasons (CC_UNATTRIBUTABLE_EXPOSURE, ` +
        `CC_HOLDINGS_UNAVAILABLE, ACCESS_TOKEN_UNAVAILABLE, NO_OPTION_CHAIN_RETURNED, MARKET_DATA_REQUEST_FAILED) ` +
        `belong to errorSession(); stop-transition reasons (CANCELLED, SUPERSEDED) belong to stopSession().`
      );
    }
    exclusions.push({ symbol, reasonCode });
  }

  let session: ScreenerScanSession = {
    sessionId: createScanSessionId(),
    mode: args.mode,
    requestedStrategy: args.requestedStrategy,
    scope: {
      universeSymbols: normalizeSymbols(args.scope.universeSymbols),
      eligibleSymbols: normalizeSymbols(args.scope.eligibleSymbols),
      universeOverridden: args.scope.universeOverridden ?? false,
    },
    selectedSymbols: plan.selectedSymbols,
    plannedScanSymbols: plan.plannedScanSymbols,
    startedAt: Date.now(),
    completedAt: null,
    status: 'running',
    symbolOutcomes: [],
    results: [],
    cacheProvenance: 'live',
    cachedAt: null,
    schemaVersion: SCHEMA_VERSION,
  };

  for (const { symbol, reasonCode } of exclusions) {
    session = recordSymbolSkipped(session, symbol, reasonCode);
  }
  return session;
}

// ── Validated transition functions ──────────────────────────────────────

export class ScanSessionTransitionError extends Error {}

function assertRunning(session: ScreenerScanSession, fnName: string): void {
  if (session.status !== 'running') {
    throw new ScanSessionTransitionError(`${fnName}: session ${session.sessionId} is '${session.status}', not 'running'.`);
  }
}

function assertNoExistingOutcome(session: ScreenerScanSession, symbol: string, fnName: string): void {
  if (session.symbolOutcomes.some(o => o.symbol === symbol)) {
    throw new ScanSessionTransitionError(`${fnName}('${symbol}'): an outcome for this symbol was already recorded (duplicate).`);
  }
}

function assertPlannedMember(session: ScreenerScanSession, symbol: string, fnName: string): void {
  if (!session.plannedScanSymbols.includes(symbol)) {
    throw new ScanSessionTransitionError(
      `${fnName}('${symbol}'): not a planned scan symbol for this session. ` +
      `Only plannedScanSymbols members may be marked evaluated or failed.`
    );
  }
}

function assertSelectedMember(session: ScreenerScanSession, symbol: string, fnName: string): void {
  if (!session.selectedSymbols.includes(symbol)) {
    throw new ScanSessionTransitionError(`${fnName}('${symbol}'): not a member of this session's selectedSymbols.`);
  }
}

// ── Shared minimum-shape check for a supplied ScreenResult ────────────────
// Used identically by recordSymbolEvaluated() (throws immediately, before
// any mutation) and validateSessionData() (accumulates as error codes) — so
// the two boundaries cannot drift apart. Checks: the result's own claimed
// symbol matches what's expected, strategy is a string permitted for
// requestedStrategy, qualified is boolean, failReasons is an array of
// strings. Does NOT validate any other ScreenResult field (bestCandidate,
// checks, etc.) — see module header "WHAT CACHE VALIDATION DOES AND DOES
// NOT ESTABLISH".
interface ResultShapeCheck {
  symbolOk: boolean;
  strategyOk: boolean;
  qualifiedOk: boolean;
  failReasonsOk: boolean;
}

function checkResultShapeForSession(
  result: unknown,
  requestedStrategy: ScreenerRequestedStrategy,
  expectedSymbol: string,
): ResultShapeCheck {
  const r = (result != null && typeof result === 'object') ? (result as Partial<ScreenResult>) : null;
  const symbolOk = r != null && r.symbol === expectedSymbol;
  const allowed = STRATEGY_RESULT_TYPES[requestedStrategy];
  const strategyOk = r != null && typeof r.strategy === 'string' && allowed.has(r.strategy);
  const qualifiedOk = r != null && typeof r.qualified === 'boolean';
  const failReasonsOk = r != null && Array.isArray(r.failReasons) && r.failReasons.every(x => typeof x === 'string');
  return { symbolOk, strategyOk, qualifiedOk, failReasonsOk };
}

// Zero results -> reasonCode REQUIRED (must be a valid zero-candidate
// reason). Nonzero results -> reasonCode FORBIDDEN. Every supplied result
// is validated via checkResultShapeForSession() BEFORE any part of the
// session is mutated — a wrong-strategy/malformed result rejects the whole
// transition and the original session is returned unchanged (this function
// never mutates its input; a thrown call simply never produces a new
// object at all).
export function recordSymbolEvaluated(
  session: ScreenerScanSession,
  symbol: string,
  results: ScreenResult[],
  options?: { reasonCode?: ScreenerReasonCode },
): ScreenerScanSession {
  assertRunning(session, 'recordSymbolEvaluated');
  assertPlannedMember(session, symbol, 'recordSymbolEvaluated');
  assertNoExistingOutcome(session, symbol, 'recordSymbolEvaluated');

  for (const r of results) {
    const check = checkResultShapeForSession(r, session.requestedStrategy, symbol);
    if (!check.symbolOk) {
      throw new ScanSessionTransitionError(
        `recordSymbolEvaluated('${symbol}'): a supplied result's symbol does not match the evaluated symbol.`
      );
    }
    if (!check.strategyOk) {
      throw new ScanSessionTransitionError(
        `recordSymbolEvaluated('${symbol}'): a supplied result's strategy is not permitted for requestedStrategy ` +
        `'${session.requestedStrategy}' — this would contaminate the live session with a foreign strategy's result.`
      );
    }
    if (!check.qualifiedOk) {
      throw new ScanSessionTransitionError(
        `recordSymbolEvaluated('${symbol}'): a supplied result's 'qualified' field must be a boolean.`
      );
    }
    if (!check.failReasonsOk) {
      throw new ScanSessionTransitionError(
        `recordSymbolEvaluated('${symbol}'): a supplied result's 'failReasons' field must be an array of strings.`
      );
    }
  }

  if (results.length === 0) {
    if (!options?.reasonCode) {
      throw new ScanSessionTransitionError(
        `recordSymbolEvaluated('${symbol}'): a reasonCode is REQUIRED when candidateCount is 0 — ` +
        `a symbol can never be evaluated into nothing with no explanation.`
      );
    }
    if (!EVALUATED_ZERO_CANDIDATE_REASON_CODES.has(options.reasonCode)) {
      throw new ScanSessionTransitionError(
        `recordSymbolEvaluated('${symbol}'): '${options.reasonCode}' is not a valid zero-candidate reason. ` +
        `NO_OPTION_CHAIN_RETURNED and failure-style codes belong on recordSymbolFailed(), not here.`
      );
    }
  } else if (options?.reasonCode) {
    throw new ScanSessionTransitionError(
      `recordSymbolEvaluated('${symbol}'): a reasonCode is not valid when real candidates were produced (candidateCount > 0).`
    );
  }

  const outcome: ScreenerSymbolOutcome = {
    symbol,
    status: 'evaluated',
    candidateCount: results.length,
    ...(options?.reasonCode ? { reasonCode: options.reasonCode } : {}),
  };
  return {
    ...session,
    symbolOutcomes: [...session.symbolOutcomes, outcome],
    results: [...session.results, ...results],
  };
}

export function recordSymbolFailed(
  session: ScreenerScanSession,
  symbol: string,
  reasonCode: ScreenerReasonCode,
): ScreenerScanSession {
  assertRunning(session, 'recordSymbolFailed');
  assertPlannedMember(session, symbol, 'recordSymbolFailed');
  assertNoExistingOutcome(session, symbol, 'recordSymbolFailed');
  const outcome: ScreenerSymbolOutcome = { symbol, status: 'failed', reasonCode, candidateCount: 0 };
  return { ...session, symbolOutcomes: [...session.symbolOutcomes, outcome] };
}

export function recordSymbolSkipped(
  session: ScreenerScanSession,
  symbol: string,
  reasonCode: ScreenerReasonCode,
): ScreenerScanSession {
  assertRunning(session, 'recordSymbolSkipped');
  assertSelectedMember(session, symbol, 'recordSymbolSkipped');
  assertNoExistingOutcome(session, symbol, 'recordSymbolSkipped');
  const outcome: ScreenerSymbolOutcome = { symbol, status: 'skipped', reasonCode, candidateCount: 0 };
  return { ...session, symbolOutcomes: [...session.symbolOutcomes, outcome] };
}

// ── Reconciliation helpers ──────────────────────────────────────────────

export function getSymbolsWithoutOutcome(session: ScreenerScanSession): string[] {
  const recorded = new Set(session.symbolOutcomes.map(o => o.symbol));
  return session.selectedSymbols.filter(sym => !recorded.has(sym));
}

export function resultsSymbolsAreMembers(session: ScreenerScanSession): boolean {
  const selectedSet = new Set(session.selectedSymbols);
  return session.results.every(r => selectedSet.has(r.symbol));
}

export function sessionResultsReconcile(session: ScreenerScanSession): boolean {
  const expected = session.symbolOutcomes
    .filter(o => o.status === 'evaluated')
    .reduce((sum, o) => sum + o.candidateCount, 0);
  return expected === session.results.length;
}

// ── Terminal transitions ─────────────────────────────────────────────────

export function completeSession(session: ScreenerScanSession): ScreenerScanSession {
  assertRunning(session, 'completeSession');

  const missing = getSymbolsWithoutOutcome(session);
  if (missing.length > 0) {
    throw new ScanSessionTransitionError(
      `completeSession: ${missing.length} selected symbol(s) have no outcome yet (${missing.join(', ')}). ` +
      `Record their outcomes first, or use stopSession()/errorSession() if the scan was cancelled or failed globally.`
    );
  }
  if (!sessionResultsReconcile(session)) {
    throw new ScanSessionTransitionError('completeSession: candidate counts do not reconcile with session.results.');
  }
  if (!resultsSymbolsAreMembers(session)) {
    throw new ScanSessionTransitionError('completeSession: session.results contains a symbol not in selectedSymbols.');
  }

  return { ...session, status: 'complete', completedAt: Date.now() };
}

export function errorSession(session: ScreenerScanSession, reasonCode: ScreenerReasonCode): ScreenerScanSession {
  assertRunning(session, 'errorSession');
  let s = session;
  for (const symbol of getSymbolsWithoutOutcome(s)) {
    s = recordSymbolFailed(s, symbol, reasonCode);
  }
  return { ...s, status: 'error', completedAt: Date.now() };
}

export function stopSession(
  session: ScreenerScanSession,
  reasonCode: 'CANCELLED' | 'SUPERSEDED',
): ScreenerScanSession {
  assertRunning(session, 'stopSession');
  let s = session;
  for (const symbol of getSymbolsWithoutOutcome(s)) {
    s = recordSymbolSkipped(s, symbol, reasonCode);
  }
  return { ...s, status: 'stopped', completedAt: Date.now() };
}

// ── Stale-response guard ────────────────────────────────────────────────
export function isSessionStale(sessionId: string, currentActiveSessionId: string | null): boolean {
  return currentActiveSessionId !== sessionId;
}

// ── Accounting ───────────────────────────────────────────────────────────

export interface ScreenerSessionAccounting {
  selectedCount: number;
  plannedCount: number;
  attemptedCount: number; // evaluatedCount + failedCount
  evaluatedCount: number;
  failedCount: number;
  skippedCount: number;
  candidateCount: number;
  qualifiedCandidateCount: number;
  disqualifiedCandidateCount: number;
}

export function computeSessionAccounting(session: ScreenerScanSession): ScreenerSessionAccounting {
  const evaluatedCount = session.symbolOutcomes.filter(o => o.status === 'evaluated').length;
  const failedCount = session.symbolOutcomes.filter(o => o.status === 'failed').length;
  const skippedCount = session.symbolOutcomes.filter(o => o.status === 'skipped').length;
  const candidateCount = session.symbolOutcomes.reduce((sum, o) => sum + o.candidateCount, 0);
  const qualifiedCandidateCount = session.results.filter(r => r.qualified).length;
  const disqualifiedCandidateCount = session.results.filter(r => !r.qualified).length;

  return {
    selectedCount: session.selectedSymbols.length,
    plannedCount: session.plannedScanSymbols.length,
    attemptedCount: evaluatedCount + failedCount,
    evaluatedCount,
    failedCount,
    skippedCount,
    candidateCount,
    qualifiedCandidateCount,
    disqualifiedCandidateCount,
  };
}

export function formatSessionAccountingSummary(session: ScreenerScanSession): string {
  const a = computeSessionAccounting(session);
  const parts = [
    `${a.selectedCount} selected`,
    `${a.plannedCount} planned`,
    `${a.attemptedCount} attempted`,
    `${a.evaluatedCount} evaluated`,
  ];
  if (a.failedCount > 0) parts.push(`${a.failedCount} failed`);
  if (a.skippedCount > 0) parts.push(`${a.skippedCount} skipped`);
  parts.push(`${a.qualifiedCandidateCount} qualified`, `${a.disqualifiedCandidateCount} disqualified`);
  return parts.join(' · ');
}

// ── Recommendation-generation gate ──────────────────────────────────────
export function shouldGenerateRecommendationsForSession(
  session: ScreenerScanSession | null,
  activeSessionId: string | null,
): boolean {
  if (session == null) return false;
  if (isSessionStale(session.sessionId, activeSessionId)) return false;
  return session.status === 'complete' && session.results.length > 0;
}

// ── Cache validation ─────────────────────────────────────────────────────

export type SessionValidationError =
  | 'NOT_AN_OBJECT'
  | 'UNKNOWN_SCHEMA_VERSION'
  | 'MISSING_SESSION_ID'
  | 'INVALID_STRATEGY'
  | 'INVALID_MODE'
  | 'INVALID_MODE_STRATEGY_COMBINATION'
  | 'INVALID_STATUS'
  | 'INVALID_TIMESTAMPS'
  | 'INVALID_SCOPE'
  | 'MALFORMED_SYMBOL_LIST'
  | 'SELECTED_SYMBOLS_MISMATCH'
  | 'PLANNED_SYMBOLS_MISMATCH'
  | 'INVALID_CACHE_PROVENANCE'
  | 'INVALID_CACHED_AT'
  | 'MISSING_OUTCOME'
  | 'UNEXPECTED_OUTCOME'
  | 'DUPLICATE_OUTCOME'
  | 'UNKNOWN_OUTCOME_STATUS'
  | 'UNKNOWN_REASON_CODE'
  | 'MISSING_ZERO_CANDIDATE_REASON'
  | 'UNEXPECTED_REASON_CODE'
  | 'INVALID_CANDIDATE_COUNT'
  | 'EVALUATED_FAILED_NOT_PLANNED'
  | 'INVALID_SCOPE_EXCLUSION_REASON'
  | 'INVALID_PLANNED_SKIP_REASON'
  | 'RESERVED_REASON_MISUSE'
  | 'CANDIDATE_RECONCILIATION_FAILED'
  | 'RESULT_SYMBOL_NOT_IN_SESSION'
  | 'RESULT_STRATEGY_MISMATCH'
  | 'INVALID_RESULT_SHAPE';

export type SessionValidationResult =
  | { valid: true; session: ScreenerScanSession }
  | { valid: false; errors: SessionValidationError[] };

// Establishes SESSION-LEVEL integrity — see module header "WHAT CACHE
// VALIDATION DOES AND DOES NOT ESTABLISH" for the precise scope.
export function validateSessionData(data: unknown): SessionValidationResult {
  const errors: SessionValidationError[] = [];

  if (data == null || typeof data !== 'object') {
    return { valid: false, errors: ['NOT_AN_OBJECT'] };
  }
  const d = data as Record<string, unknown>;

  if (d.schemaVersion !== SCHEMA_VERSION) errors.push('UNKNOWN_SCHEMA_VERSION');
  if (typeof d.sessionId !== 'string' || d.sessionId.length === 0) errors.push('MISSING_SESSION_ID');

  const strategyValid = typeof d.requestedStrategy === 'string' && VALID_STRATEGIES.has(d.requestedStrategy);
  if (!strategyValid) errors.push('INVALID_STRATEGY');

  const modeValid = typeof d.mode === 'string' && VALID_MODES.has(d.mode);
  if (!modeValid) errors.push('INVALID_MODE');

  if (strategyValid && modeValid) {
    const strategy = d.requestedStrategy as ScreenerRequestedStrategy;
    const mode = d.mode as ScreenerScanMode;
    if (!STRATEGY_ALLOWED_MODES[strategy].has(mode)) errors.push('INVALID_MODE_STRATEGY_COMBINATION');
  }

  const statusValid = typeof d.status === 'string' && VALID_STATUSES.has(d.status);
  if (!statusValid) errors.push('INVALID_STATUS');
  const status = statusValid ? (d.status as ScreenerSessionStatus) : null;

  const startedAt = d.startedAt;
  const completedAt = d.completedAt;
  const startedAtValid = typeof startedAt === 'number' && Number.isFinite(startedAt) && startedAt > 0;
  if (!startedAtValid) {
    errors.push('INVALID_TIMESTAMPS');
  } else if (status === 'running') {
    if (completedAt !== null) errors.push('INVALID_TIMESTAMPS');
  } else if (status != null) {
    if (typeof completedAt !== 'number' || !Number.isFinite(completedAt) || completedAt < (startedAt as number)) {
      errors.push('INVALID_TIMESTAMPS');
    }
  }

  // ── Scope ──
  const rawScope = d.scope as Record<string, unknown> | undefined;
  const scopeStructurallyValid =
    rawScope != null && typeof rawScope === 'object' &&
    isNormalizedSymbolArray(rawScope.universeSymbols) &&
    isNormalizedSymbolArray(rawScope.eligibleSymbols) &&
    typeof rawScope.universeOverridden === 'boolean';
  if (!scopeStructurallyValid) errors.push('INVALID_SCOPE');

  // ── selectedSymbols / plannedScanSymbols structure ──
  const selected = d.selectedSymbols;
  const planned = d.plannedScanSymbols;
  const selectedValid = isNormalizedSymbolArray(selected);
  const plannedValid = isNormalizedSymbolArray(planned);
  if (!selectedValid || !plannedValid) errors.push('MALFORMED_SYMBOL_LIST');

  if (scopeStructurallyValid && selectedValid && plannedValid) {
    const expectedPlan = resolveScanPlan({
      universeSymbols: rawScope!.universeSymbols as string[],
      eligibleSymbols: rawScope!.eligibleSymbols as string[],
      universeOverridden: rawScope!.universeOverridden as boolean,
    });
    const selectedSet = new Set(selected as string[]);
    const expectedSelectedSet = new Set(expectedPlan.selectedSymbols);
    if (selectedSet.size !== expectedSelectedSet.size || !Array.from(selectedSet).every(s => expectedSelectedSet.has(s))) {
      errors.push('SELECTED_SYMBOLS_MISMATCH');
    }
    const plannedSet = new Set(planned as string[]);
    const expectedPlannedSet = new Set(expectedPlan.plannedScanSymbols);
    if (plannedSet.size !== expectedPlannedSet.size || !Array.from(plannedSet).every(s => expectedPlannedSet.has(s))) {
      errors.push('PLANNED_SYMBOLS_MISMATCH');
    }
  }

  // ── cacheProvenance / cachedAt ──
  if (typeof d.cacheProvenance !== 'string' || !VALID_CACHE_PROVENANCE.has(d.cacheProvenance)) {
    errors.push('INVALID_CACHE_PROVENANCE');
  }
  if (d.cachedAt !== null && !(typeof d.cachedAt === 'number' && Number.isFinite(d.cachedAt))) {
    errors.push('INVALID_CACHED_AT');
  }

  // ── symbolOutcomes ──
  const rawOutcomes = Array.isArray(d.symbolOutcomes) ? (d.symbolOutcomes as unknown[]) : null;
  const validatedOutcomes: ScreenerSymbolOutcome[] = [];
  if (!rawOutcomes) {
    errors.push('MISSING_OUTCOME');
  } else {
    const seen = new Set<string>();
    const selectedSet = selectedValid ? new Set(selected as string[]) : null;
    const plannedSet = plannedValid ? new Set(planned as string[]) : null;

    for (const raw of rawOutcomes) {
      const o = raw as Partial<ScreenerSymbolOutcome> | null;
      if (!o || typeof o.symbol !== 'string') { errors.push('MISSING_OUTCOME'); continue; }

      if (selectedSet && !selectedSet.has(o.symbol)) errors.push('UNEXPECTED_OUTCOME');
      if (seen.has(o.symbol)) errors.push('DUPLICATE_OUTCOME');
      seen.add(o.symbol);

      const statusOk = typeof o.status === 'string' && VALID_OUTCOME_STATUSES.has(o.status);
      if (!statusOk) { errors.push('UNKNOWN_OUTCOME_STATUS'); continue; }
      const outcomeStatus = o.status as ScreenerSymbolOutcomeStatus;

      const candidateCountOk = typeof o.candidateCount === 'number' && Number.isInteger(o.candidateCount) && o.candidateCount >= 0;
      if (!candidateCountOk) errors.push('INVALID_CANDIDATE_COUNT');

      if (outcomeStatus === 'evaluated') {
        if (candidateCountOk && o.candidateCount === 0) {
          const reasonOk = typeof o.reasonCode === 'string'
            && VALID_REASON_CODES.has(o.reasonCode)
            && EVALUATED_ZERO_CANDIDATE_REASON_CODES.has(o.reasonCode as ScreenerReasonCode);
          if (!reasonOk) errors.push('MISSING_ZERO_CANDIDATE_REASON');
        } else if (candidateCountOk && (o.candidateCount as number) > 0) {
          if (o.reasonCode != null) errors.push('UNEXPECTED_REASON_CODE');
        }
        if (plannedSet && !plannedSet.has(o.symbol)) errors.push('EVALUATED_FAILED_NOT_PLANNED');
      } else {
        const reasonOk = typeof o.reasonCode === 'string' && VALID_REASON_CODES.has(o.reasonCode);
        if (!reasonOk) errors.push('UNKNOWN_REASON_CODE');
        if (candidateCountOk && o.candidateCount !== 0) errors.push('INVALID_CANDIDATE_COUNT');
        if (outcomeStatus === 'failed' && plannedSet && !plannedSet.has(o.symbol)) errors.push('EVALUATED_FAILED_NOT_PLANNED');

        if (reasonOk) {
          const reason = o.reasonCode as ScreenerReasonCode;

          // CC_UNATTRIBUTABLE_EXPOSURE is reserved exclusively for
          // errorSession()'s account-wide fail-closed path — it must never
          // appear outside an 'error' session, on either a failed or
          // skipped outcome.
          if (reason === 'CC_UNATTRIBUTABLE_EXPOSURE' && status !== 'error') {
            errors.push('RESERVED_REASON_MISUSE');
          }

          if (outcomeStatus === 'skipped' && plannedSet) {
            const isPlannedButSkipped = plannedSet.has(o.symbol);
            if (isPlannedButSkipped) {
              // A planned symbol that ended up skipped only ever got there
              // via stopSession() — cancellation or supersession, never a
              // scope-exclusion reason (it was eligible and scheduled; it
              // just never got reached).
              if (reason !== 'CANCELLED' && reason !== 'SUPERSEDED') {
                errors.push('INVALID_PLANNED_SKIP_REASON');
              }
            } else {
              // A selected-but-not-planned symbol was excluded before any
              // attempt was made — only a construction-time scope-exclusion
              // reason is valid here, never CANCELLED/SUPERSEDED or a
              // global-failure reason.
              if (!ALLOWED_SCOPE_EXCLUSION_REASON_CODES.has(reason)) {
                errors.push('INVALID_SCOPE_EXCLUSION_REASON');
              }
            }
          }
        }
      }

      if (statusOk && candidateCountOk) {
        validatedOutcomes.push({
          symbol: o.symbol,
          status: outcomeStatus,
          candidateCount: o.candidateCount as number,
          ...(o.reasonCode ? { reasonCode: o.reasonCode as ScreenerReasonCode } : {}),
        });
      }
    }

    if (selectedSet && status != null && status !== 'running') {
      for (const sym of Array.from(selectedSet)) {
        if (!seen.has(sym)) errors.push('MISSING_OUTCOME');
      }
    }
  }

  // ── results ──
  const rawResults = Array.isArray(d.results) ? (d.results as Array<Record<string, unknown>>) : null;
  if (!rawResults) {
    errors.push('CANDIDATE_RECONCILIATION_FAILED');
  } else {
    const selectedSet = selectedValid ? new Set(selected as string[]) : null;

    let resultSymbolsValid = true;
    for (const r of rawResults) {
      const sym = r?.symbol;
      if (typeof sym !== 'string' || (selectedSet && !selectedSet.has(sym))) resultSymbolsValid = false;

      // Same shared helper recordSymbolEvaluated() uses for the live
      // transition — the two boundaries cannot drift apart. Passing the
      // result's own claimed symbol as expectedSymbol makes symbolOk
      // trivial here (membership is already checked above); this call
      // exists purely to share the strategy/qualified/failReasons checks.
      if (typeof sym === 'string' && strategyValid) {
        const check = checkResultShapeForSession(r, d.requestedStrategy as ScreenerRequestedStrategy, sym);
        if (!check.strategyOk) errors.push('RESULT_STRATEGY_MISMATCH');
        if (!check.qualifiedOk) errors.push('INVALID_RESULT_SHAPE');
        if (!check.failReasonsOk) errors.push('INVALID_RESULT_SHAPE');
      }
    }
    if (!resultSymbolsValid) errors.push('RESULT_SYMBOL_NOT_IN_SESSION');

    const resultCountsBySymbol = new Map<string, number>();
    for (const r of rawResults) {
      const sym = r?.symbol;
      if (typeof sym === 'string') resultCountsBySymbol.set(sym, (resultCountsBySymbol.get(sym) ?? 0) + 1);
    }
    for (const outcome of validatedOutcomes) {
      if (outcome.status !== 'evaluated') continue;
      const actual = resultCountsBySymbol.get(outcome.symbol) ?? 0;
      if (actual !== outcome.candidateCount) {
        errors.push('CANDIDATE_RECONCILIATION_FAILED');
        break;
      }
    }
    const evaluatedSymbols = new Set(validatedOutcomes.filter(o => o.status === 'evaluated').map(o => o.symbol));
    for (const sym of Array.from(resultCountsBySymbol.keys())) {
      if (!evaluatedSymbols.has(sym)) {
        errors.push('CANDIDATE_RECONCILIATION_FAILED');
        break;
      }
    }
  }

  const uniqueErrors = Array.from(new Set(errors));
  if (uniqueErrors.length > 0) return { valid: false, errors: uniqueErrors };

  return {
    valid: true,
    session: {
      sessionId: d.sessionId as string,
      mode: d.mode as ScreenerScanMode,
      requestedStrategy: d.requestedStrategy as ScreenerRequestedStrategy,
      scope: {
        universeSymbols: (rawScope!.universeSymbols as string[]),
        eligibleSymbols: (rawScope!.eligibleSymbols as string[]),
        universeOverridden: rawScope!.universeOverridden as boolean,
      },
      selectedSymbols: selected as string[],
      plannedScanSymbols: planned as string[],
      startedAt: startedAt as number,
      completedAt: (completedAt ?? null) as number | null,
      status: status as ScreenerSessionStatus,
      symbolOutcomes: validatedOutcomes,
      results: rawResults as unknown as ScreenResult[],
      cacheProvenance: d.cacheProvenance as 'live' | 'idb-cache',
      cachedAt: (d.cachedAt ?? null) as number | null,
      schemaVersion: SCHEMA_VERSION,
    },
  };
}
