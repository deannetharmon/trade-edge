// lib/revalidation/types.ts
//
// MB-0001B: Revalidation Engine -- given a Trader Commitment (active trading
// intent the trader already decided on) and the current, already-computed
// portfolio context, determine whether anything material has changed since
// the commitment was made. If nothing changed, say nothing (see
// docs/design/MB-0001B-Review-Conductor-Foundation.md's "silence is a
// feature" principle -- this engine's contract makes that literal: a rule
// returns `null`, not an empty-but-truthy result, when there is nothing to
// report). If something changed, produce a RevalidationChange explaining
// what changed, why it matters, and why now.
//
// This engine performs no evaluation, scoring, or market-data acquisition
// of its own -- RevalidationContext is built entirely from values other,
// existing producers already computed (PortfolioObjective from
// lib/portfolio-intelligence, position DTE from the same
// TodaysPrioritiesPositionInput-shaped data lib/todaysPriorities already
// reads). It is a pure comparison layer, not a second Decision Engine.

import type { PortfolioObjective } from '@/lib/portfolio-intelligence';
import type { TraderCommitment, TraderCommitmentKind } from '@/lib/trader-commitments';

// Already-computed position facts a rule may need. Deliberately narrow --
// only the fields an actual scaffolded rule below reads today. Extend this
// (never fabricate a field a rule doesn't really use) as new rules are
// added.
export interface RevalidationPositionContext {
  dte: number;
}

export interface RevalidationContext {
  // Caller-supplied, never read from the clock internally (matches this
  // codebase's now-parameter convention, e.g. evaluatePositionObjective(input, now)).
  now: string;
  // The commitment subject's current PortfolioObjective, if one exists and
  // was already computed upstream this review cycle. `null` when the
  // subject currently has no objective (e.g. a healthy Monitor-tier
  // position, or the objective genuinely was not supplied) -- rules must
  // treat this as "insufficient context to evaluate", never as "nothing
  // changed" or "something changed" on its own.
  objective: PortfolioObjective | null;
  // Already-computed position facts, when the subject is position-backed
  // and that data is available. `null` when not applicable/available.
  position: RevalidationPositionContext | null;
}

export interface RevalidationChange {
  whatChanged: string;
  whyItMatters: string;
  whyNow: string;
}

export interface RevalidationResult {
  commitment: TraderCommitment;
  changed: boolean;
  // `null` exactly when `changed` is false -- the type itself enforces the
  // "silence is a feature" contract rather than leaving it to convention.
  change: RevalidationChange | null;
}

export type RevalidationRule = (commitment: TraderCommitment, context: RevalidationContext) => RevalidationChange | null;

// Partial by design: a commitment kind with no registered rule is not a bug
// or a placeholder -- see rules.ts's module doc for exactly which kinds have
// no rule yet and why (each requires data this codebase does not yet
// compute anywhere, and inventing a rule without that data would mean
// fabricating a signal).
export type RevalidationRuleRegistry = Partial<Record<TraderCommitmentKind, RevalidationRule>>;
