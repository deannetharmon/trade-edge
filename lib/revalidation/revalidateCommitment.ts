// lib/revalidation/revalidateCommitment.ts
//
// MB-0001B: the Revalidation Engine's one entry point. Pure and
// deterministic -- same commitment + same context always produces the same
// result; no fetch, no clock read, no persistence.

import { DEFAULT_REVALIDATION_RULES } from './rules';
import type { RevalidationContext, RevalidationResult, RevalidationRuleRegistry } from './types';
import type { TraderCommitment } from '@/lib/trader-commitments';

// Given a Trader Commitment and the current, already-computed context,
// determine whether anything material has changed. `rules` defaults to the
// engine's own scaffolded rule set but is overridable -- primarily so tests
// (and, later, a richer rule set) can supply a different registry without
// this function itself changing.
export function revalidateCommitment(
  commitment: TraderCommitment,
  context: RevalidationContext,
  rules: RevalidationRuleRegistry = DEFAULT_REVALIDATION_RULES,
): RevalidationResult {
  const rule = rules[commitment.kind];
  const change = rule ? rule(commitment, context) : null;

  return {
    commitment,
    changed: change !== null,
    change,
  };
}

// Revalidates a whole set of commitments. `contextFor` lets each commitment
// receive its own context (a different subject may have a different
// objective/position) without this function acquiring any data itself --
// the caller (Review Conductor) is responsible for supplying already-
// computed context per commitment.
export function revalidateCommitments(
  commitments: TraderCommitment[],
  contextFor: (commitment: TraderCommitment) => RevalidationContext,
  rules: RevalidationRuleRegistry = DEFAULT_REVALIDATION_RULES,
): RevalidationResult[] {
  return commitments.map((commitment) => revalidateCommitment(commitment, contextFor(commitment), rules));
}
