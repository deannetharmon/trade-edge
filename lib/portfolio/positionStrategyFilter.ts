// lib/portfolio/positionStrategyFilter.ts
//
// Positions Strategy Filter -- CSP/CC/PMCC/LEAP resolve from
// classifyPositionLifecycle()'s lifecycle-level classification; BPS/BCS/IC resolve from
// pos.strategy, since classifyPositionLifecycle only tags those as the generic SPREAD bucket and
// doesn't distinguish among them. A position resolving to neither (e.g. ASSIGNED_STOCK, a naked
// single-leg PUT/CALL, or UNKNOWN) has no matching filter key at all --
// resolvePositionStrategyFilterKey returns null for it, and it's ALWAYS shown regardless of which
// filter chips are toggled, since none of the seven checkboxes claim to cover it.
//
// Lives outside app/portfolio/page.tsx: Next.js App Router restricts page.tsx named exports to a
// specific allowlist (default export, metadata, generateMetadata, etc.) -- exporting this
// function/type/constant directly from the page file breaks the production build ("... is not a
// valid Page export field"), even though it type-checks cleanly with `tsc --noEmit` alone (this is
// a Next.js-specific constraint, not a TypeScript one, so it's easy to miss without a full
// `next build`).

import { classifyPositionLifecycle } from '@/lib/portfolio/positionLifecycle';
import type { Position } from '@/lib/portfolio-data/types';

export type PositionStrategyFilterKey = 'CSP' | 'CC' | 'PMCC' | 'LEAP' | 'BPS' | 'BCS' | 'IC';

export const POSITION_STRATEGY_FILTER_KEYS: PositionStrategyFilterKey[] =
  ['CSP', 'CC', 'PMCC', 'LEAP', 'BPS', 'BCS', 'IC'];

export function resolvePositionStrategyFilterKey(pos: Position): PositionStrategyFilterKey | null {
  const lifecycleType = classifyPositionLifecycle(pos).type;
  if (lifecycleType === 'CSP') return 'CSP';
  if (lifecycleType === 'COVERED_CALL') return 'CC';
  if (lifecycleType === 'PMCC') return 'PMCC';
  if (lifecycleType === 'LEAPS') return 'LEAP';
  if (pos.strategy === 'BPS') return 'BPS';
  if (pos.strategy === 'BCS') return 'BCS';
  if (pos.strategy === 'IC') return 'IC';
  return null;
}
