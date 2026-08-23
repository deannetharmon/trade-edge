// lib/portfolio/positionStrategyFilter.ts
//
// Positions Strategy Filter -- CSP/CC/PMCC/LEAP resolve from
// classifyPositionLifecycle()'s lifecycle-level classification; BPS/BCS/IC resolve from
// pos.strategy, since classifyPositionLifecycle only tags those as the generic SPREAD bucket and
// doesn't distinguish among them. PUT and NAKED are resolved here directly from the position's
// option legs (see below) -- classifyPositionLifecycle has no bucket for either shape. A position
// resolving to none of these nine (e.g. ASSIGNED_STOCK, or UNKNOWN) has no matching filter key at
// all -- resolvePositionStrategyFilterKey returns null for it, and it's ALWAYS shown regardless of
// which filter chips are toggled, since none of the nine checkboxes claim to cover it.
//
// Lives outside app/portfolio/page.tsx: Next.js App Router restricts page.tsx named exports to a
// specific allowlist (default export, metadata, generateMetadata, etc.) -- exporting this
// function/type/constant directly from the page file breaks the production build ("... is not a
// valid Page export field"), even though it type-checks cleanly with `tsc --noEmit` alone (this is
// a Next.js-specific constraint, not a TypeScript one, so it's easy to miss without a full
// `next build`).

import {
  classifyPositionLifecycle,
  splitOptionLegs,
  isCashSecuredPut,
  type LifecycleLeg,
} from '@/lib/portfolio/positionLifecycle';
import type { Position } from '@/lib/portfolio-data/types';

export type PositionStrategyFilterKey =
  'CSP' | 'CC' | 'PMCC' | 'LEAP' | 'BPS' | 'BCS' | 'IC' | 'PUT' | 'NAKED';

export const POSITION_STRATEGY_FILTER_KEYS: PositionStrategyFilterKey[] =
  ['CSP', 'CC', 'PMCC', 'LEAP', 'BPS', 'BCS', 'IC', 'PUT', 'NAKED'];

// A standalone long put -- no short legs of either type, no long calls. Deliberately ungated by
// DTE (unlike LEAP's long-call gate): a long put is more often held as a shorter-term directional
// bet or hedge than a LEAPS-style multi-year position, so restricting this bucket to only
// long-dated puts would hide most of what a person actually means by "my put positions." Covers
// both a short-term protective/speculative put and a long-dated one in the same bucket.
export function isPutOnlyPosition(legs: LifecycleLeg[] = []): boolean {
  const { shortPuts, longPuts, shortCalls, longCalls } = splitOptionLegs(legs);
  return longPuts.length > 0 && shortPuts.length === 0 && shortCalls.length === 0 && longCalls.length === 0;
}

// An uncovered short call or short put -- some short option exposure with no offsetting long leg
// at all (so it's not a spread/PMCC) and not already claimed by the single-short-put CSP bucket
// (isCashSecuredPut requires exactly one short put with nothing else; two or more naked short
// puts, or any naked short call, falls through to here instead). Does NOT check share coverage
// (the CC/ASSIGNED_STOCK paths already own that distinction via classifyPositionLifecycle) --
// this bucket exists specifically to surface the highest-risk, least-hedged shapes in one place.
export function isNakedPosition(legs: LifecycleLeg[] = []): boolean {
  const { shortPuts, longPuts, shortCalls, longCalls } = splitOptionLegs(legs);
  const hasShortExposure = shortPuts.length > 0 || shortCalls.length > 0;
  const hasNoLongHedge = longPuts.length === 0 && longCalls.length === 0;
  return hasShortExposure && hasNoLongHedge && !isCashSecuredPut(legs);
}

export function resolvePositionStrategyFilterKey(pos: Position): PositionStrategyFilterKey | null {
  const lifecycleType = classifyPositionLifecycle(pos).type;
  if (lifecycleType === 'CSP') return 'CSP';
  if (lifecycleType === 'COVERED_CALL') return 'CC';
  if (lifecycleType === 'PMCC') return 'PMCC';
  if (lifecycleType === 'LEAPS') return 'LEAP';
  if (pos.strategy === 'BPS') return 'BPS';
  if (pos.strategy === 'BCS') return 'BCS';
  if (pos.strategy === 'IC') return 'IC';
  if (isPutOnlyPosition(pos.legs)) return 'PUT';
  if (isNakedPosition(pos.legs)) return 'NAKED';
  return null;
}
