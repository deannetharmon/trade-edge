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

// -- Filter chip grouping -----------------------------------------------------
//
// The nine keys cluster into three families. CSP and PUT sit deliberately
// adjacent across the Income/Directional boundary (last in Income, first in
// Directional) -- they're opposites, not variants (CSP collects premium,
// PUT pays it), so adjacency here is for easy side-by-side contrast, not
// because they belong in the same family.
export interface PositionStrategyFilterGroup {
  label: string;
  keys: PositionStrategyFilterKey[];
}

export const POSITION_STRATEGY_FILTER_GROUPS: PositionStrategyFilterGroup[] = [
  { label: 'Income', keys: ['CC', 'PMCC', 'BPS', 'BCS', 'IC', 'CSP'] },
  { label: 'Directional', keys: ['PUT', 'LEAP'] },
  { label: 'Risk', keys: ['NAKED'] },
];

// -- Card/row display label ---------------------------------------------------
//
// The existing pos.strategy field (and strategyLabelForStructure in
// closeOrderSafety.ts, which produces it for most positions) is leg-type/
// structure-type only -- a naked short put (CSP) and a standalone long put
// both render as bare 'PUT', and a naked short call renders as bare 'CALL'
// with no indication it's uncovered. pos.strategy itself is left untouched
// (its own comment states it's never used for any safety decision, but it's
// also read from several other display call sites this change doesn't
// touch) -- this is a purely additive label used only where the card badge
// renders, falling back to pos.strategy unchanged for anything outside the
// nine filter buckets (ASSIGNED_STOCK, UNKNOWN, etc.).
// -- Holding-horizon labels (Dean, 2026-10-16) ----------------------------------------------------
//
// A standalone long call or long put is tagged by the days to expiration it had WHEN IT WAS OPENED
// (entryDte), so the label never changes as the position ages: 90 or fewer = plain CALL / PUT,
// 91 to 269 = MID CALL / MID PUT, 270 or more = LEAP / LEAP PUT. This is a DISPLAY label only. It does
// not change classifyPositionLifecycle, the LEAP filter key, PMCC pairing, or stop eligibility, which
// still use PMCC_LONG_DTE_MIN (120). Falls back to the current dte when entryDte is not available.
export const MID_LABEL_MIN_ENTRY_DTE = 91;
export const LEAP_LABEL_MIN_ENTRY_DTE = 270;

export type HoldingHorizon = 'SHORT' | 'MID' | 'LEAP';

export function holdingHorizonFor(pos: Pick<Position, 'entryDte' | 'dte'>): HoldingHorizon {
  const dte = Number.isFinite(pos.entryDte) ? pos.entryDte : pos.dte;
  if (!Number.isFinite(dte)) return 'SHORT';
  if (dte >= LEAP_LABEL_MIN_ENTRY_DTE) return 'LEAP';
  if (dte >= MID_LABEL_MIN_ENTRY_DTE) return 'MID';
  return 'SHORT';
}

function isStandaloneLongCallOnly(legs: LifecycleLeg[] = []): boolean {
  const { shortPuts, longPuts, shortCalls, longCalls } = splitOptionLegs(legs);
  return longCalls.length > 0 && shortPuts.length === 0 && longPuts.length === 0 && shortCalls.length === 0;
}

/** CALL / MID CALL / LEAP for a call, PUT / MID PUT / LEAP PUT for a put, by entry DTE. */
export function horizonOptionLabel(optionType: 'C' | 'P', pos: Pick<Position, 'entryDte' | 'dte'>): string {
  const horizon = holdingHorizonFor(pos);
  if (optionType === 'C') return horizon === 'LEAP' ? 'LEAP' : horizon === 'MID' ? 'MID CALL' : 'CALL';
  return horizon === 'LEAP' ? 'LEAP PUT' : horizon === 'MID' ? 'MID PUT' : 'PUT';
}

/** Label for a position that is exactly one long option leg (the positions table), otherwise null. */
export function standaloneLongOptionLabel(pos: Pick<Position, 'legs' | 'entryDte' | 'dte'>): string | null {
  const legs = pos.legs ?? [];
  if (legs.length !== 1 || legs[0]?.direction !== 'Long') return null;
  const t = legs[0].optionType;
  return t === 'C' || t === 'P' ? horizonOptionLabel(t, pos) : null;
}

export function resolvePositionStrategyDisplayLabel(pos: Position): string {
  const key = resolvePositionStrategyFilterKey(pos);
  if (key === 'LEAP' || (key === null && isStandaloneLongCallOnly(pos.legs))) {
    return horizonOptionLabel('C', pos);
  }
  if (key === null) return pos.strategy;
  if (key === 'PUT') {
    return horizonOptionLabel('P', pos);
  }
  if (key === 'NAKED') {
    const { shortPuts, shortCalls } = splitOptionLegs(pos.legs);
    if (shortCalls.length > 0 && shortPuts.length > 0) return 'NAKED STRANGLE';
    return shortCalls.length > 0 ? 'NAKED CALL' : 'NAKED PUT';
  }
  return key;
}

// Color classes for the card badge, keyed off the resolved filter key rather
// than the display label text (avoids string-matching "NAKED CALL" etc.).
// Falls back to the caller's own existing stratColor(pos.strategy) handling
// for anything outside the nine buckets -- this function only opinionates on
// what it actually classifies.
export function stratColorForFilterKey(key: PositionStrategyFilterKey | null): string | null {
  if (key === 'NAKED') return 'text-red-400 border-red-700';
  if (key === 'PUT') return 'text-amber-400 border-amber-700';
  if (key === 'LEAP') return 'text-violet-400 border-violet-700';
  if (key === 'BPS') return 'text-emerald-400 border-emerald-700';
  if (key === 'BCS') return 'text-red-400 border-red-700';
  if (key === 'IC') return 'text-blue-400 ac-border-faint';
  return null; // CSP/CC/PMCC and null (unclassified) defer to the caller's existing color logic
}
