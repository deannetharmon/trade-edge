// lib/position-snapshot/types.ts
//
// PI-0009A: Position Snapshot Engine, V1.
//
// Captures an immutable record of a position's state at three lifecycle
// moments: when it's first detected, whenever its recommendation changes,
// and when it closes. This is deliberately narrower than the existing daily
// PositionSnapshot in app/portfolio/page.tsx (which records Greeks/IV every
// day the Portfolio page loads, for Net Edge peak/trend) -- this one is
// event-driven, not calendar-driven, and captures Decision Engine output
// (recommendation/confidence/evidence) rather than raw Greeks. The two are
// independent and intentionally do not share a store.

// Only existing, already-computed metrics are captured (per the ticket: "no
// speculative fields"). Nothing here is calculated fresh by this module --
// every field is read from values app/portfolio/page.tsx already produces
// via lib/portfolio-intelligence, lib/portfolio/positionLifecycle.ts, and
// the position's own live fields.

export type PositionSnapshotEvent = 'POSITION_DETECTED' | 'RECOMMENDATION_CHANGE' | 'POSITION_CLOSE';

// Earnings status is a simple derived read of the same
// isUpcomingEarningsRisk(earningsDate, expDate) check app/portfolio/page.tsx
// already uses elsewhere -- not a new calculation.
export type EarningsStatus = 'UPCOMING' | 'NONE' | 'UNKNOWN';

export interface PositionLifecycleSnapshot {
  id: string;
  positionKey: string;
  event: PositionSnapshotEvent;
  capturedAt: string; // ISO timestamp

  symbol: string;
  strategy: string;
  dte: number;

  // Credit/debit: what was collected at entry vs. what it would currently
  // cost to close (or did cost, for a POSITION_CLOSE snapshot built from the
  // last known live values).
  creditReceived: number | null;
  entryEconomicsComplete: boolean;
  closeValue: number | null;

  delta: number | null;
  pop: number | null;
  netEdge: number | null;
  healthScore: number | null;
  remainingOpportunityPct: number | null;

  // Decision Engine output at the moment of capture.
  recommendation: string | null; // PortfolioRecommendation.label
  confidence: number | null;     // PortfolioRecommendation.confidence
  keyEvidence: string[];         // [primaryReason, ...supportingReasons]

  earningsStatus: EarningsStatus;
  earningsDate: string | null;
}

// Append-only, keyed by position key. Snapshots for a given key are ordered
// by capturedAt ascending as they're appended; nothing is ever mutated or
// removed except via the route's DELETE (full-store clear, for debugging).
export type PositionSnapshotStore = Record<string, PositionLifecycleSnapshot[]>;

// Lean, page-agnostic input shape -- deliberately decoupled from
// app/portfolio/page.tsx's much larger `Position` interface so this engine
// stays independently testable without importing that file. The page maps
// its own Position objects into this shape before calling the engine.
export interface PositionSnapshotInput {
  key: string;
  symbol: string;
  strategy: string;
  dte: number;
  creditReceived: number | null;
  entryEconomicsComplete: boolean;
  closeValue: number | null;
  delta: number | null;
  pop: number | null;
  netEdge: number | null;
  healthScore: number | null;
  remainingOpportunityPct: number | null;
  recommendationLabel: string | null;
  confidence: number | null;
  primaryReason: string | null;
  supportingReasons: string[];
  earningsStatus: EarningsStatus;
  earningsDate: string | null;
}
