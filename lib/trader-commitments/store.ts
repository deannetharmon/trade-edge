// lib/trader-commitments/store.ts
//
// MB-0001B: pure, deterministic logic only -- no fetch, no Redis, no React
// here, matching lib/decision-review/decisionReview.ts's own module doc.
// This file does not persist anything itself; a future caller (an API
// route, a client store) supplies and saves the TraderCommitmentStore value
// however it chooses. That persistence layer is explicitly out of scope for
// this foundation sprint.

import type {
  GtcWorkingCommitment,
  HoldUntilDteCommitment,
  LetThetaWorkCommitment,
  MonitorCommitment,
  TraderCommitment,
  TraderCommitmentStore,
  TraderCommitmentSubject,
  WaitForEarningsCommitment,
} from './types';

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

// Matches this codebase's existing id-generation shape (see
// lib/decision-review's createDecisionReviewId() and
// evaluatePortfolioObjectives.ts's createId()) -- time-based prefix +
// random suffix, not a UUID library.
export function createTraderCommitmentId(now: Date = new Date()): string {
  return `commitment_${now.getTime().toString(36)}_${randomSuffix()}`;
}

export type CreateTraderCommitmentInput =
  | { kind: 'HOLD_UNTIL_DTE'; subject: TraderCommitmentSubject; targetDte: number; note?: string | null }
  // reviewAfter is optional and defaults to null (indefinite acknowledgment)
  // -- a caller that doesn't set a re-review date is making an honest choice
  // not to, not leaving the field unfinished. See types.ts's module doc on
  // MonitorCommitment.
  | { kind: 'MONITOR'; subject: TraderCommitmentSubject; reviewAfter?: string | null; note?: string | null }
  | { kind: 'LET_THETA_WORK'; subject: TraderCommitmentSubject; note?: string | null }
  | { kind: 'WAIT_FOR_EARNINGS'; subject: TraderCommitmentSubject; note?: string | null }
  | { kind: 'GTC_WORKING'; subject: TraderCommitmentSubject; orderId: string | null; note?: string | null };

// The one place a TraderCommitment is ever constructed -- every field the
// trader didn't supply gets an honest default (status is always 'active',
// note defaults to null), never a fabricated placeholder value.
export function createTraderCommitment(input: CreateTraderCommitmentInput, now: Date = new Date()): TraderCommitment {
  const base = {
    id: createTraderCommitmentId(now),
    createdAt: now.toISOString(),
    subject: input.subject,
    status: 'active' as const,
    note: input.note ?? null,
  };

  switch (input.kind) {
    case 'HOLD_UNTIL_DTE':
      return { ...base, kind: 'HOLD_UNTIL_DTE', targetDte: input.targetDte } satisfies HoldUntilDteCommitment;
    case 'MONITOR':
      return { ...base, kind: 'MONITOR', reviewAfter: input.reviewAfter ?? null } satisfies MonitorCommitment;
    case 'LET_THETA_WORK':
      return { ...base, kind: 'LET_THETA_WORK' } satisfies LetThetaWorkCommitment;
    case 'WAIT_FOR_EARNINGS':
      return { ...base, kind: 'WAIT_FOR_EARNINGS' } satisfies WaitForEarningsCommitment;
    case 'GTC_WORKING':
      return { ...base, kind: 'GTC_WORKING', orderId: input.orderId } satisfies GtcWorkingCommitment;
  }
}

export function upsertTraderCommitment(store: TraderCommitmentStore, commitment: TraderCommitment): TraderCommitmentStore {
  return { ...store, [commitment.id]: commitment };
}

// Removes a commitment entirely -- there is no archival/history status to
// transition it to (see types.ts's module doc on why). Returns the same
// store reference when the id was already absent, so callers can call this
// unconditionally without an extra existence check.
export function removeTraderCommitment(store: TraderCommitmentStore, id: string): TraderCommitmentStore {
  if (!(id in store)) return store;
  const next = { ...store };
  delete next[id];
  return next;
}

// Every commitment in the store is active by construction (this foundation
// models no other status) -- this function exists mainly for call-site
// clarity ("give me the active set") and as the one place a future status
// dimension would need to add a filter.
export function listActiveCommitments(store: TraderCommitmentStore): TraderCommitment[] {
  return Object.values(store);
}

export function commitmentsForSubject(store: TraderCommitmentStore, subjectId: string): TraderCommitment[] {
  return listActiveCommitments(store).filter((c) => c.subject.id === subjectId);
}

// ---------------------------------------------------------------------------
// Store parsing -- fails closed on anything unexpected, matching this
// codebase's existing "corrupted data recovers to empty, never throws"
// posture (see lib/decision-review's parseDecisionReviewStore()).
// ---------------------------------------------------------------------------
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidSubject(value: unknown): value is TraderCommitmentSubject {
  if (!isPlainRecord(value)) return false;
  return (
    (value.type === 'position' || value.type === 'portfolio') &&
    (value.id === null || typeof value.id === 'string') &&
    (value.symbol === null || typeof value.symbol === 'string') &&
    typeof value.label === 'string'
  );
}

function isValidCommitment(value: unknown): value is TraderCommitment {
  if (!isPlainRecord(value)) return false;
  if (
    typeof value.id !== 'string' ||
    typeof value.createdAt !== 'string' ||
    value.status !== 'active' ||
    !(value.note === null || typeof value.note === 'string') ||
    !isValidSubject(value.subject)
  ) {
    return false;
  }

  switch (value.kind) {
    case 'HOLD_UNTIL_DTE':
      return typeof value.targetDte === 'number' && Number.isFinite(value.targetDte);
    case 'MONITOR':
      return value.reviewAfter === null || typeof value.reviewAfter === 'string';
    case 'LET_THETA_WORK':
    case 'WAIT_FOR_EARNINGS':
      return true;
    case 'GTC_WORKING':
      return value.orderId === null || typeof value.orderId === 'string';
    default:
      return false;
  }
}

// Parses a raw JSON string (as read from Redis, localStorage, or an HTTP
// response body) into a TraderCommitmentStore. Never throws: invalid JSON,
// a non-object shape, or individual malformed entries all degrade to "not
// present" rather than crashing the caller -- a corrupt or partially
// corrupt store loses only the entries that are actually unreadable.
export function parseTraderCommitmentStore(raw: string | null | undefined): TraderCommitmentStore {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isPlainRecord(parsed)) return {};

  const store: TraderCommitmentStore = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (isValidCommitment(value)) store[key] = value;
  }
  return store;
}
