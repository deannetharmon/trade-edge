// lib/portfolio-data/pmccPairDetection.ts

import type { Position } from './types';
import { PMCC_LONG_DTE_MIN, PMCC_SHORT_DTE_MAX } from '@/lib/portfolio/positionLifecycle';

// PAIR-0001: loadPositions() buckets raw broker positions by
// `underlying-symbol :: expiration-date` before building Position records
// (see loadPositions() in acquisition.ts). A PMCC's long leg (LEAPS, far
// expiration) and short leg (near-dated) always land in different buckets,
// so they arrive as two SEPARATE Position records -- a single Position's
// own `.legs` array can never contain both. That's also why
// classifyPositionLifecycle()'s 'PMCC' branch can't fire from the live
// portfolio feed when called per-Position (a related, separate gap, not
// addressed here). This function is the one place that answers "does this
// held long call have a held short call paired against it" by looking
// across the full Position[] list, not a single position in isolation.
//
// Reuses PMCC_SHORT_DTE_MAX/PMCC_LONG_DTE_MIN from positionLifecycle.ts
// rather than redefining thresholds -- single source of truth for what
// counts as a PMCC shape (Ian).

// Per Ian: the long leg must clear the same long-dated bar PMCC's own long
// leg uses, checked BEFORE searching for a short-side match. A short-dated
// long call paired with an even-shorter call is a spread, not a PMCC base.
function isPmccLongLegCandidate(position: Position): boolean {
  const legs = position.legs ?? [];
  if (legs.length !== 1) return false;
  const leg = legs[0];
  if (leg.direction !== 'Long' || leg.optionType !== 'C') return false;
  return position.dte > PMCC_LONG_DTE_MIN;
}

function isPmccShortLegCandidate(position: Position): boolean {
  const legs = position.legs ?? [];
  if (legs.length !== 1) return false;
  const leg = legs[0];
  if (leg.direction !== 'Short' || leg.optionType !== 'C') return false;
  return position.dte < PMCC_SHORT_DTE_MAX;
}

// Returns the held short-call Position paired against longPosition as a
// PMCC, or null if longPosition isn't a PMCC long-leg candidate at all, or
// no matching short call is currently held.
//
// Multiple candidate short calls on the same symbol (e.g. a rolled short
// call not yet closed) resolve to the soonest-expiring (lowest-DTE) match --
// the one actively decaying and most likely to need management next; an
// older, rolled-away short call would typically already be closed. This is
// a reasonable default, not a guarantee of correctness for that edge case --
// per Alan, a genuinely ambiguous multi-match situation should be reviewed
// by whichever consumer (Net Edge gating, existing-position income) needs
// to decide how much to trust it, not silently resolved here as if it were
// certain.
//
// The matched short call is returned regardless of its own
// structureAmbiguous state -- the pairing relationship is a fact independent
// of whether the short leg's structure is currently clean. Consumers decide
// separately whether an ambiguous paired short call is trustworthy enough
// to act on (Alan).
export function findPairedShortCall(longPosition: Position, allPositions: Position[]): Position | null {
  if (!isPmccLongLegCandidate(longPosition)) return null;

  const candidates = allPositions.filter(candidate =>
    candidate.key !== longPosition.key
    && candidate.symbol === longPosition.symbol
    && isPmccShortLegCandidate(candidate)
  );
  if (candidates.length === 0) return null;

  return candidates.reduce((soonest, candidate) => candidate.dte < soonest.dte ? candidate : soonest);
}

export function isPairedPmccLong(longPosition: Position, allPositions: Position[]): boolean {
  return findPairedShortCall(longPosition, allPositions) != null;
}
