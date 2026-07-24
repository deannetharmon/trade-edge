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

import { useSyncExternalStore } from 'react';
import type { DecisionAnalysis } from '@/lib/decision-engine';

export interface RecommendationSet {
  analyses: DecisionAnalysis[];
  generatedAt: string | null;
}

const EMPTY_STATE: RecommendationSet = { analyses: [], generatedAt: null };

let currentState: RecommendationSet = EMPTY_STATE;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

/**
 * Returns the current real recommendation set. Empty (`analyses: []`,
 * `generatedAt: null`) whenever nothing has been published yet in this
 * session -- an honest empty state, never a fabricated one.
 */
export function getCurrentRecommendations(): RecommendationSet {
  return currentState;
}

/**
 * Producer-side entry point. `analyses` must already be a real,
 * already-evaluated DecisionAnalysis[] (e.g. the Screener's existing
 * POST /api/autopilot/recommendations result) -- this function does not
 * evaluate, validate, rank, or otherwise interpret it; it only stores and
 * announces it.
 */
export function publishRecommendations(analyses: DecisionAnalysis[], generatedAt: string = new Date().toISOString()): void {
  currentState = { analyses, generatedAt };
  notify();
}

/** Resets to the empty state. Exposed for producers that need to disclose "no current candidates" explicitly (e.g. an empty scan) rather than leaving a stale prior result visible. */
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
