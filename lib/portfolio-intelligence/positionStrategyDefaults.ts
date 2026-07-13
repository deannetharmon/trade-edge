// lib/portfolio-intelligence/positionStrategyDefaults.ts
//
// PI-0004B: deterministic, backward-compatible defaults for the new
// PositionStrategy / AssignmentPreference fields (see types.ts).
//
// AssignmentPreference maps cleanly onto the Portfolio page's existing
// per-position `intent` field ('income' | 'acquisition' | 'neutral',
// persisted via /api/position-intent) -- 'acquisition' already means "the
// trader wants the shares; assignment is success, not failure" in this
// codebase's existing AI-prompt wording, which is exactly AssignmentPreference
// PREFER. This derivation is wired into every real position today (see
// app/portfolio/page.tsx), so AssignmentPreference is live in production.
//
// PositionStrategy has no equivalent existing source -- WHEEL is a genuinely
// new concept this sprint introduces, and the brief is explicit: existing
// ACQUIRE-shaped positions must not be silently reclassified as WHEEL. There
// is deliberately no derivePositionStrategy() here; positionStrategy stays
// undefined for every real position until an explicit control exists to set
// it (tracked as a PI-0004C follow-up). Callers that want to exercise the
// Wheel-aware logic (tests, or a future UI) set positionStrategy directly.

import type { AssignmentPreference } from './types';

export function deriveAssignmentPreferenceFromIntent(
  intent: string | null | undefined,
): AssignmentPreference {
  switch (intent) {
    case 'acquisition':
      return 'PREFER';
    case 'income':
      return 'AVOID';
    default:
      return 'ACCEPT';
  }
}
