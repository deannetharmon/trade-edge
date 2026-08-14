'use client';

// lib/recommendations/RecommendationService.ts
//
// CES-0001 (OE-0002B, revised): the canonical acquisition boundary for
// "what is the current set of real, evaluated trade candidates right now."
//
// Architectural role (see docs/design/OE-0002B-Recommendation-Service-Foundation.md):
//   Decision Engine    -- evaluates candidates. Nothing else.
//   Opportunity Engine -- compares/ranks candidates. Nothing else.
//   Recommendation Service (this file) -- acquires/holds the current
//     DecisionAnalysis[]. Nothing else. It does not rank, does not filter,
//     does not know what "capital available" or any other OpportunityContext
//     means -- that is the caller's job, via the existing, unmodified
//     lib/opportunity-engine / lib/command-center wrappers.
//   Dashboard (or any future consumer) -- renders. It reads from this
//     service and calls the existing ranking wrapper itself; it never
//     acquires data on its own.
//
// A producer (today, only the Screener's existing recommendation-pipeline
// wiring from OE-0002A) calls publishRecommendations() with a real,
// already-evaluated DecisionAnalysis[] the moment it has one. A consumer
// (today, only the Dashboard) reads the current set via
// getCurrentRecommendations() / useCurrentRecommendations() and is
// completely unaware of who published it, how, or from where.
//
// Deliberately NOT persisted (no localStorage/IndexedDB/Redis/audit log):
// this is in-memory module state only, alive for as long as the current
// browser tab's JS runtime is (i.e. it survives client-side navigation
// between routes, which is the real-world "ran a scan, then checked the
// dashboard" workflow, but not a hard reload). Adding persistence is
// explicitly out of scope for this sprint -- see the design doc's Future
// Work section for what a durable version of this boundary would need.
//
// Future producers (Background Scanner, Scheduled Scanner, Autopilot, an
// AI Recommendation Engine) only need to call publishRecommendations() the
// same way the Screener does. No Dashboard change would be required to
// adopt any of them -- this is the whole point of the boundary.
//
// PO corrective round 4 (WA-0005 Defect 1): this service previously held
// ONLY `{ analyses, generatedAt }` -- the last successfully published set,
// with no way for a consumer (Mission Control) to know whether a NEWER
// evaluation attempt is currently running, or whether the most recent
// attempt failed. Round 3's report treated "Stale results" as structurally
// unreachable at Mission Control's boundary on exactly this basis. The
// Product Owner's round 4 review found that framing incomplete: a genuine
// distinction DOES exist between "the currently-published recommendations"
// and "a newer evaluation is running/failed since that publish" --
// /screener's own `opportunityState`/`opportunityError` (app/screener/
// page.tsx) already compute this signal in real time; it simply was never
// routed through this service to any other consumer. This file now carries
// that real, already-computed lifecycle signal alongside the last
// successfully published set, so a newer attempt's in-flight/failed status
// can be observed WITHOUT ever losing or fabricating the last known-good
// `analyses`/`generatedAt` -- the two are independent fields, deliberately:
// `status`/`error` describe the MOST RECENT evaluation ATTEMPT (which may
// still be running, or may have failed, independent of what's published),
// while `analyses`/`generatedAt` describe the last attempt that actually
// SUCCEEDED. This is not a new evaluation engine and fabricates nothing --
// it is the same real state /screener already tracks locally, now also
// announced through this existing pub/sub boundary.

import { useSyncExternalStore } from 'react';
import type { DecisionAnalysis } from '@/lib/decision-engine';

/**
 * The lifecycle of the MOST RECENT evaluation attempt -- independent of
 * whether that attempt is the one currently reflected in `analyses`/
 * `generatedAt` below:
 *   'idle'    -- no evaluation attempt is currently running or known-failed
 *                beyond whatever is currently published (the common case:
 *                either nothing has ever run, or the last attempt is the
 *                one already reflected in analyses/generatedAt).
 *   'loading' -- a real evaluation attempt is in flight right now (set by
 *                beginRecommendationsEvaluation()). analyses/generatedAt
 *                still hold whatever was last successfully published, if
 *                anything -- never cleared just because a newer attempt
 *                started.
 *   'error'   -- the most recent evaluation attempt failed (set by
 *                failRecommendationsEvaluation()). analyses/generatedAt
 *                again still hold the last successfully published set, if
 *                any -- a failed refresh must never blank out a
 *                previously-valid result.
 */
export type RecommendationEvaluationStatus = 'idle' | 'loading' | 'error';

export interface RecommendationSet {
  analyses: DecisionAnalysis[];
  generatedAt: string | null;
  /** See `RecommendationEvaluationStatus`'s own doc comment. Defaults to 'idle'. */
  status: RecommendationEvaluationStatus;
  /** The most recent evaluation attempt's failure message, or `null` when `status !== 'error'`. */
  error: string | null;
}

const EMPTY_STATE: RecommendationSet = { analyses: [], generatedAt: null, status: 'idle', error: null };

let currentState: RecommendationSet = EMPTY_STATE;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

/**
 * Returns the current real recommendation set. Empty (`analyses: []`,
 * `generatedAt: null`, `status: 'idle'`, `error: null`) whenever nothing
 * has been published yet in this session -- an honest empty state, never a
 * fabricated one.
 */
export function getCurrentRecommendations(): RecommendationSet {
  return currentState;
}

/**
 * Producer-side entry point. `analyses` must already be a real,
 * already-evaluated DecisionAnalysis[] (e.g. the Screener's existing
 * POST /api/autopilot/recommendations result) -- this function does not
 * evaluate, validate, rank, or otherwise interpret it; it only stores and
 * announces it. Marks the evaluation lifecycle `status` back to 'idle' and
 * clears `error` -- this successful publish IS the most recent attempt's
 * outcome, so there is nothing newer left in flight or failed to report.
 */
export function publishRecommendations(analyses: DecisionAnalysis[], generatedAt: string = new Date().toISOString()): void {
  currentState = { analyses, generatedAt, status: 'idle', error: null };
  notify();
}

/**
 * PO corrective round 4 (Defect 1): announces that a NEW evaluation attempt
 * has started, without touching the last successfully published
 * `analyses`/`generatedAt` -- callers (today, app/screener/page.tsx, at the
 * exact same moment it sets its own local `opportunityState: 'loading'`)
 * call this so any consumer (Mission Control) can distinguish "an
 * evaluation is running right now" from "here is the last completed set,"
 * which this service previously had no way to express. A prior `error` is
 * cleared -- a fresh attempt supersedes the outcome of the one before it
 * until this attempt itself resolves.
 */
export function beginRecommendationsEvaluation(): void {
  currentState = { ...currentState, status: 'loading', error: null };
  notify();
}

/**
 * PO corrective round 4 (Defect 1): announces that the most recent
 * evaluation attempt failed, without touching the last successfully
 * published `analyses`/`generatedAt` -- the prior valid set (if any)
 * remains exactly as it was; only the lifecycle status changes. Callers
 * (today, app/screener/page.tsx, at the exact same moment it sets its own
 * local `opportunityState: 'error'`/`opportunityError`) call this so any
 * consumer can distinguish "the most recent attempt failed" from "nothing
 * has ever run," which this service previously had no way to express.
 */
export function failRecommendationsEvaluation(message: string): void {
  currentState = { ...currentState, status: 'error', error: message };
  notify();
}

/** Resets to the fully empty state (analyses, generatedAt, status, and error). Exposed for producers that need to disclose "no current candidates" explicitly (e.g. an empty scan) rather than leaving a stale prior result visible. */
export function clearRecommendations(): void {
  currentState = EMPTY_STATE;
  notify();
}

export function subscribeToRecommendations(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React hook for consumers. Server snapshot is the empty state, matching this service's own "no publisher yet" default. */
export function useCurrentRecommendations(): RecommendationSet {
  return useSyncExternalStore(subscribeToRecommendations, getCurrentRecommendations, () => EMPTY_STATE);
}
