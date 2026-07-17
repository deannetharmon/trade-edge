// lib/decision-review/decisionReview.ts
//
// PI-0008C: Decision Outcome Tracking V1 -- pure, deterministic logic only.
// No fetch, no Redis, no React here (see route.ts for persistence, and
// features/portfolio/decisionReview/ for the UI that calls these functions).
//
// Every function below is pure: same input always produces the same output,
// nothing here reads the clock except where a `now` parameter makes that
// explicit and overridable (matching this codebase's existing convention in
// e.g. evaluatePositionObjective(input, now)).

import type { PortfolioRecommendation } from '@/lib/portfolio-intelligence';
import type {
  DecisionHistoryFilter,
  DecisionOutcomeStatus,
  DecisionReview,
  DecisionReviewEvidenceSnapshot,
  DecisionReviewStore,
  TraderAction,
} from './types';

// A stable identifier set, however the caller happens to have it (Array or
// Set) -- accepting both avoids forcing every call site to construct a Set
// just to call this function.
export type PositionIdSet = Set<string> | string[];

function hasPositionId(openPositionIds: PositionIdSet, positionId: string): boolean {
  return Array.isArray(openPositionIds) ? openPositionIds.includes(positionId) : openPositionIds.has(positionId);
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

// Matches this codebase's existing id-generation shape (see
// evaluatePortfolioObjectives.ts's createId() and positionObjective.ts's
// objective id) -- time-based prefix + random suffix, not a UUID library.
export function createDecisionReviewId(now: Date = new Date()): string {
  return `review_${now.getTime().toString(36)}_${randomSuffix()}`;
}

// Builds the frozen evidence snapshot from a live PortfolioRecommendation.
// Pure and total: every field on ManagementIntentResult is optional from
// this function's perspective (a recommendation predating PI-0006B, or a
// test fixture, may not carry one) -- falls back to conservative defaults
// rather than throwing, matching this codebase's general "absence is not an
// error" posture (see managementIntent.ts's own evidence-field doc comments).
export function buildEvidenceSnapshot(recommendation: PortfolioRecommendation): DecisionReviewEvidenceSnapshot {
  const mi = recommendation.managementIntent;
  return {
    managementIntent: mi?.intent ?? recommendation.kind,
    label: recommendation.label,
    primaryReason: recommendation.primaryReason,
    reasons: mi?.reasons ?? recommendation.supportingReasons ?? [],
    confidence: recommendation.confidence,
    winnerScore: mi?.winnerScore ?? null,
    runnerUpIntent: mi?.runnerUpIntent ?? null,
    runnerUpScore: mi?.runnerUpScore ?? null,
    margin: mi?.margin ?? null,
    confidenceTier: mi?.confidenceTier ?? null,
  };
}

export interface CreateDecisionReviewInput {
  positionId: string;
  symbol: string;
  strategy: string;
  recommendation: PortfolioRecommendation;
  recommendedAt?: string; // defaults to `now` -- the caller may pass the recommendation's own computedAt instead
  traderAction?: TraderAction | null;
  outcomeStatus?: DecisionOutcomeStatus;
  realizedPnl?: number | null;
  notes?: string;
}

// Creates a brand-new review. The evidence snapshot is built once here and
// never recomputed by updateDecisionReview() below -- that is what
// "snapshot integrity" (ticket #7) means: this call site is the only place
// `evidence` is ever set.
export function createDecisionReview(input: CreateDecisionReviewInput, now: Date = new Date()): DecisionReview {
  const nowIso = now.toISOString();
  return {
    id: createDecisionReviewId(now),
    positionId: input.positionId,
    symbol: input.symbol,
    strategy: input.strategy,
    recommendedAt: input.recommendedAt ?? nowIso,
    evidence: buildEvidenceSnapshot(input.recommendation),
    traderAction: input.traderAction ?? null,
    traderActionAt: input.traderAction ? nowIso : null,
    outcomeStatus: input.outcomeStatus ?? 'PENDING',
    realizedPnl: input.realizedPnl ?? null,
    notes: input.notes ?? '',
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export interface DecisionReviewPatch {
  traderAction?: TraderAction | null;
  outcomeStatus?: DecisionOutcomeStatus;
  realizedPnl?: number | null;
  notes?: string;
}

// Edits an existing review. Every identity/snapshot field (id, positionId,
// symbol, strategy, recommendedAt, evidence, createdAt) is preserved exactly
// -- only the trader-editable fields in DecisionReviewPatch, plus
// `updatedAt`, ever change. `traderActionAt` is stamped fresh only when
// `traderAction` is actually part of this patch (and non-null); editing
// notes or outcome alone does not touch it.
export function updateDecisionReview(
  existing: DecisionReview,
  patch: DecisionReviewPatch,
  now: Date = new Date(),
): DecisionReview {
  const nowIso = now.toISOString();
  const traderActionChanged = Object.prototype.hasOwnProperty.call(patch, 'traderAction');
  return {
    ...existing,
    traderAction: traderActionChanged ? patch.traderAction ?? null : existing.traderAction,
    traderActionAt: traderActionChanged
      ? (patch.traderAction ? nowIso : null)
      : existing.traderActionAt,
    outcomeStatus: patch.outcomeStatus ?? existing.outcomeStatus,
    realizedPnl: Object.prototype.hasOwnProperty.call(patch, 'realizedPnl') ? patch.realizedPnl ?? null : existing.realizedPnl,
    notes: patch.notes ?? existing.notes,
    updatedAt: nowIso,
  };
}

// ---------------------------------------------------------------------------
// Store parsing -- fails closed on anything unexpected, matching this
// codebase's existing "corrupted data recovers to empty, never throws"
// posture (see priorityWorkflowState.ts's localStorage load, TE-0004C).
// ---------------------------------------------------------------------------
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidReview(value: unknown): value is DecisionReview {
  if (!isPlainRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.positionId === 'string' &&
    typeof value.symbol === 'string' &&
    typeof value.strategy === 'string' &&
    typeof value.recommendedAt === 'string' &&
    isPlainRecord(value.evidence) &&
    typeof value.outcomeStatus === 'string' &&
    typeof value.notes === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  );
}

// Parses a raw JSON string (as read from Redis, or from an HTTP response
// body) into a DecisionReviewStore. Never throws: invalid JSON, a
// non-object shape, or individual malformed entries all degrade to "not
// present" rather than crashing the caller -- a corrupt or partially
// corrupt store loses only the entries that are actually unreadable.
export function parseDecisionReviewStore(raw: string | null | undefined): DecisionReviewStore {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isPlainRecord(parsed)) return {};
  const store: DecisionReviewStore = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (isValidReview(value)) store[key] = value;
  }
  return store;
}

export function upsertDecisionReview(store: DecisionReviewStore, review: DecisionReview): DecisionReviewStore {
  return { ...store, [review.id]: review };
}

// The most recently updated review for a given position, or null if none
// exists yet -- what the Position Intelligence panel shows/edits (ticket #5
// treats "an existing review" as singular per position at a time; a trader
// wanting a fresh review for the same position can still create another one,
// which then becomes the "latest").
export function latestReviewForPosition(store: DecisionReviewStore, positionId: string): DecisionReview | null {
  const matches = Object.values(store).filter((r) => r.positionId === positionId);
  if (matches.length === 0) return null;
  return matches.reduce((latest, r) => (r.updatedAt > latest.updatedAt ? r : latest));
}

// Every review, newest-first -- what the Decision History view lists.
export function allReviewsByRecency(store: DecisionReviewStore): DecisionReview[] {
  return Object.values(store).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// Ticket #6's five filters, plus PI-0008D's NEEDS_FOLLOW_UP. "Followed" /
// "Did Not Follow" are read directly off the trader's own logged action
// (FOLLOWED_RECOMMENDATION vs. any other non-null action) -- a mechanical
// read of what the trader recorded, never a comparison against the
// recommended intent, per this ticket's explicit "do not determine
// correctness automatically." `openPositionIds` is only consulted for
// NEEDS_FOLLOW_UP and defaults to empty (every Pending review would count as
// needing follow-up if the caller doesn't supply the open-position set,
// which is the safe default -- never silently hiding a reminder).
export function filterDecisionReviews(
  reviews: DecisionReview[],
  filter: DecisionHistoryFilter,
  openPositionIds: PositionIdSet = [],
): DecisionReview[] {
  switch (filter) {
    case 'ALL':
      return reviews;
    case 'PENDING':
      return reviews.filter((r) => r.outcomeStatus === 'PENDING');
    case 'FAVORABLE':
      return reviews.filter((r) => r.outcomeStatus === 'FAVORABLE');
    case 'UNFAVORABLE':
      return reviews.filter((r) => r.outcomeStatus === 'UNFAVORABLE');
    case 'FOLLOWED':
      return reviews.filter((r) => r.traderAction === 'FOLLOWED_RECOMMENDATION');
    case 'NOT_FOLLOWED':
      return reviews.filter((r) => r.traderAction != null && r.traderAction !== 'FOLLOWED_RECOMMENDATION');
    case 'NEEDS_FOLLOW_UP':
      return reviews.filter((r) => r.outcomeStatus === 'PENDING' && !hasPositionId(openPositionIds, r.positionId));
  }
}

// PI-0008D: Decision Review Follow-Up Reminder.
//
// Reminder-only, by design (see this ticket's constraints): this never sets
// or infers outcomeStatus, realizedPnl, or anything about whether the
// recommendation was correct. It only answers a mechanical question -- is
// this review still Pending while its position is no longer open? -- using
// two facts that already exist (the review's own outcomeStatus, and the
// caller's current open-position id set). Nothing here reads Autopilot's
// decision log, Trade Log, or any P/L data.
export function reviewsNeedingFollowUp(store: DecisionReviewStore, openPositionIds: PositionIdSet): DecisionReview[] {
  return Object.values(store).filter(
    (review) => review.outcomeStatus === 'PENDING' && !hasPositionId(openPositionIds, review.positionId),
  );
}

// Same predicate as reviewsNeedingFollowUp(), for a single already-in-hand
// review -- what the Decision History view uses to mark individual rows
// without re-deriving the whole list.
export function isReviewNeedingFollowUp(review: DecisionReview, openPositionIds: PositionIdSet): boolean {
  return review.outcomeStatus === 'PENDING' && !hasPositionId(openPositionIds, review.positionId);
}
