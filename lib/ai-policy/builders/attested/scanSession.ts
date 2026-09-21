// lib/ai-policy/builders/attested/scanSession.ts
//
// Builds the bounded, allowlisted `client_attested` analysis input for a completed scan session (ADR-0005). The scan
// session lives only in the browser, so the client sends it and this builder (1) checks it with the screener's own
// validator, (2) requires status 'complete', (3) re-derives what pure functions can re-derive (days to expiration,
// counts) and rejects on mismatch, and (4) copies ONLY registry fields into the payload. Free-form text, identifiers not
// in the registry, and anything else the client sent is dropped, and every string that is kept is an enum, a constant
// from server code, or matches a strict pattern, so client text can never reach a prompt.
//
// Read-only: imports pure functions and types from the screener. It never mutates its argument (tests deep-freeze it).

import { computeSessionAccounting, REASON_CODE_LABELS, validateSessionData } from '@/lib/screener/scanSession';
import type { ScreenerScanSession } from '@/lib/screener/scanSession';
import { pmccDte } from '@/lib/scans/pmccPairing';
import { buildAnalysisInput } from '../../inputStore';
import { CANDIDATE_FIELDS, MAX_CANDIDATE_ROWS, MAX_OUTCOME_ROWS, SCAN_REGISTRY } from '../../registries/scanSession';
import type { CandidateFieldDef } from '../../registries/scanSession';
import type { AnalysisInput } from '../../types';

export const SCAN_SNAPSHOT_SCHEMA_VERSION = 'scan_summary.v1';
/** ADR-0005: the client's stored DTE may differ from a re-derived one by the wall-clock rounding the scan itself uses. */
export const DTE_TOLERANCE_DAYS = 1;

const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.^/-]{0,11}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PRESET_RE = /^[A-Za-z0-9_ -]{1,40}$/;
const ENUM_RE = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_ABS = 1e9;

export interface BuildScanSessionParams {
  userId: string;
  /** The untrusted session object exactly as the client sent it. Not mutated. */
  session: unknown;
  accountScope: string;
  nowMs?: number;
  maxCandidateRows?: number;
}

export type BuildScanSessionResult = { ok: true; input: AnalysisInput } | { ok: false; reason: 'INPUT_INVALID'; detail: string };

const invalid = (detail: string): BuildScanSessionResult => ({ ok: false, reason: 'INPUT_INVALID', detail });

const isPlainRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isBoundedNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_ABS;

class Reject extends Error {}

/** Reads one candidate field into a payload value, or undefined when absent. Throws Reject on a malformed value. */
function readField(def: CandidateFieldDef, source: Record<string, unknown> | null): string | number | boolean | undefined {
  const raw = source?.[def.prop ?? def.key];
  if (raw === undefined || raw === null) return undefined;
  switch (def.format) {
    case 'text':
      if (typeof raw !== 'string' || !(def.key === 'symbol' ? SYMBOL_RE : ENUM_RE).test(raw)) throw new Reject(`field:${def.key}`);
      return raw;
    case 'date':
      if (typeof raw !== 'string' || !DATE_RE.test(raw)) throw new Reject(`field:${def.key}`);
      return raw;
    case 'boolean':
      if (typeof raw !== 'boolean') throw new Reject(`field:${def.key}`);
      return raw;
    case 'integer':
      if (!isBoundedNumber(raw) || !Number.isInteger(raw)) throw new Reject(`field:${def.key}`);
      return raw;
    default:
      if (!isBoundedNumber(raw)) throw new Reject(`field:${def.key}`);
      return raw;
  }
}

function checkDte(expiration: unknown, dte: unknown, asOf: Date, label: string): void {
  if (expiration === undefined || expiration === null) return;
  if (typeof expiration !== 'string' || typeof dte !== 'number') throw new Reject(`${label}:missing`);
  const derived = pmccDte(expiration, asOf);
  if (derived == null || Math.abs(derived - dte) > DTE_TOLERANCE_DAYS) throw new Reject(`${label}:mismatch`);
}

function sortKey(result: Record<string, unknown>, index: number): [number, number] {
  const rank = typeof result.publishedRank === 'number' ? result.publishedRank : typeof result.publishedOrder === 'number' ? result.publishedOrder : Number.MAX_SAFE_INTEGER;
  return [rank, index];
}

export function buildScanSessionInput(params: BuildScanSessionParams): BuildScanSessionResult {
  const validation = validateSessionData(params.session);
  if (!validation.valid) return invalid(`session:${validation.errors[0] ?? 'invalid'}`);
  const session: ScreenerScanSession = validation.session;
  if (session.status !== 'complete') return invalid(`status:${session.status}`);
  if (typeof session.completedAt !== 'number' || !Number.isFinite(session.completedAt) || !Number.isFinite(session.startedAt)) return invalid('timestamps');
  if (session.symbolOutcomes.length > MAX_OUTCOME_ROWS) return invalid('oversize:outcomes');

  try {
    const asOf = new Date(session.startedAt);
    const accounting = computeSessionAccounting(session);
    const cap = Math.max(1, Math.min(params.maxCandidateRows ?? MAX_CANDIDATE_ROWS, MAX_CANDIDATE_ROWS));

    // Every result that carries a candidate is checked (an omitted row that fails the check still signals tampering).
    const withCandidates = session.results
      .map((result, index) => ({ result: result as unknown as Record<string, unknown>, index }))
      .filter(({ result }) => isPlainRecord(result.bestCandidate));
    for (const { result } of withCandidates) {
      const candidate = result.bestCandidate as Record<string, unknown>;
      checkDte(candidate.expiration, candidate.dte, asOf, 'dte');
      checkDte(candidate.longExpiration, candidate.longDte, asOf, 'longDte');
    }

    const ordered = withCandidates
      .map((entry) => ({ ...entry, key: sortKey(entry.result, entry.index) }))
      .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1]);
    const included = ordered.slice(0, cap);

    const candidates = included.map(({ result }) => {
      const sources: Record<'result' | 'candidate' | 'pmccDecision', Record<string, unknown> | null> = {
        result,
        candidate: result.bestCandidate as Record<string, unknown>,
        pmccDecision: isPlainRecord(result.pmccDecision) ? result.pmccDecision : null,
      };
      const row: Record<string, string | number | boolean> = {};
      for (const def of CANDIDATE_FIELDS) {
        const value = readField(def, sources[def.from]);
        if (value !== undefined) row[def.key] = value;
      }
      if (typeof row.symbol !== 'string') throw new Reject('field:symbol');
      return row;
    });

    const outcomes = session.symbolOutcomes.map((outcome) => {
      if (!SYMBOL_RE.test(outcome.symbol)) throw new Reject('field:outcome.symbol');
      if (!ENUM_RE.test(outcome.status) || !isBoundedNumber(outcome.candidateCount) || !Number.isInteger(outcome.candidateCount)) throw new Reject('field:outcome');
      const row: Record<string, string | number> = { symbol: outcome.symbol, status: outcome.status, candidateCount: outcome.candidateCount };
      if (outcome.reasonCode !== undefined) {
        // The label comes from server code, never from the client.
        row.reasonCode = outcome.reasonCode;
        row.reasonLabel = REASON_CODE_LABELS[outcome.reasonCode];
        if (typeof row.reasonLabel !== 'string') throw new Reject('field:reasonCode');
      }
      return row;
    });

    const filters: Record<string, string | number | boolean> = {};
    const csp = session.ruleSnapshot;
    if (csp) {
      if (!PRESET_RE.test(csp.preset)) throw new Reject('field:preset');
      filters.preset = csp.preset;
      for (const key of ['ivrMin', 'ivrMax', 'deltaMin', 'deltaMax', 'dteMin', 'dteMax', 'oiMin', 'bidAskMax', 'popMin', 'otmMin', 'rocMin'] as const) {
        const v = csp[key];
        if (v === null || v === undefined) continue;
        if (!isBoundedNumber(v)) throw new Reject(`filter:${key}`);
        filters[key] = v;
      }
    }
    const targeted = session.targetedSnapshot;
    if (targeted) {
      if (!PRESET_RE.test(targeted.preset) || !isBoundedNumber(targeted.minimumCreditRatio)) throw new Reject('filter:targeted');
      filters.preset = targeted.preset;
      filters.minimumCreditRatio = targeted.minimumCreditRatio;
      filters.creditRatioOverride = targeted.creditRatioOverride;
    }

    const payload = {
      scan: {
        strategy: session.requestedStrategy,
        mode: session.mode,
        symbolsSelected: accounting.selectedCount,
        symbolsPlanned: accounting.plannedCount,
        symbolsEvaluated: accounting.evaluatedCount,
        symbolsFailed: accounting.failedCount,
        symbolsSkipped: accounting.skippedCount,
        candidatesFound: accounting.candidateCount,
        candidatesPassedRules: accounting.qualifiedCandidateCount,
        candidatesFailedRules: accounting.disqualifiedCandidateCount,
        candidateRowsIncluded: candidates.length,
        candidateRowsOmitted: ordered.length - candidates.length,
      },
      filters,
      outcomes,
      candidates,
    };

    if (session.sessionId.length > 150) return invalid('sessionId');
    return buildAnalysisInput({
      userId: params.userId,
      accountScope: params.accountScope,
      route: 'scan_summary',
      trust: 'client_attested',
      schemaVersion: SCAN_SNAPSHOT_SCHEMA_VERSION,
      subjectKey: `scan-session:${session.sessionId}`,
      deterministicStates: ['scan_session:complete'],
      payload,
      sourceAsOf: { quoteGreeks: null, brokerPositionCapacity: null, earningsCalendar: null, scanCalculation: new Date(session.completedAt).toISOString() },
      registry: SCAN_REGISTRY,
      nowMs: params.nowMs,
    });
  } catch (error) {
    if (error instanceof Reject) return invalid(error.message);
    throw error;
  }
}
