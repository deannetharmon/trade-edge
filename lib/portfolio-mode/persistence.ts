// lib/portfolio-mode/persistence.ts
//
// PT-0002A: versioned, hydration-safe persistence for the selected
// PortfolioMode. Persists ONLY the mode identifier -- never portfolio data,
// never balances, never positions (see the design doc's Persistence
// Requirements). Follows this codebase's existing convention of storing
// small, client-only UI/workflow preferences directly in localStorage
// (LS_THEME in lib/theme.ts, PRIORITY_WORKFLOW_STORAGE_KEY in
// features/portfolio/priorities/priorityWorkflowState.ts) rather than a new
// API route -- mode selection is a client-side preference, not trading
// data, and has no server-side meaning today.
//
// Deliberately diverges from those existing examples in one respect: this
// module's read result distinguishes "nothing stored yet" from "something
// invalid is stored" and never collapses the invalid case into a default.
// lib/theme.ts and priorityWorkflowState.ts both silently fall back to a
// default on any unreadable value, which is the right call for a theme
// preference or a completion-state cache -- it is explicitly NOT the right
// call here, because Mandatory Invariant 5 in the design doc requires
// missing/ambiguous portfolio context to fail visibly rather than silently
// resolve to LIVE or PAPER.

import { isPortfolioMode, type PortfolioMode } from './types';

// Versioned so a future schema change can be introduced without silently
// misinterpreting an old value as valid -- an old, differently-shaped value
// under this exact key would already fail isPortfolioMode() and be treated
// as 'invalid' (never silently defaulted), but the explicit version suffix
// also lets a future format change use a NEW key (e.g. `-v2`) and treat the
// old key as simply absent, without needing a migration step.
export const PORTFOLIO_MODE_STORAGE_KEY = 'hunter-portfolio-mode-v1';

export type PersistedPortfolioModeResult =
  // No value has ever been stored under this key. Distinct from 'invalid':
  // per the design doc, first-ever use is documented, tested new-user
  // initialization, not ambiguity.
  | { status: 'first-use' }
  // A value was stored and it is exactly 'LIVE' or 'PAPER'.
  | { status: 'valid'; mode: PortfolioMode }
  // A value exists under this key but is not a valid PortfolioMode (corrupt
  // JSON-free raw string, an old/unrecognized value, or the storage read
  // itself threw, e.g. storage disabled/unavailable). `rawValue` is the
  // literal stored string when read succeeded, or null when the read itself
  // failed. Either way, the caller must never coerce this into LIVE or
  // PAPER -- see PortfolioModeProvider's handling of this status.
  | { status: 'invalid'; rawValue: string | null };

export function readPersistedPortfolioMode(): PersistedPortfolioModeResult {
  if (typeof window === 'undefined') {
    // Server-side render: there is no persisted client state to read yet.
    // Treated the same as first-use by the provider's initial (pre-effect)
    // render -- see PortfolioModeProvider's module doc for why this never
    // actually reaches the client as a committed 'first-use' decision
    // without a real, client-side read first.
    return { status: 'first-use' };
  }
  try {
    const raw = window.localStorage.getItem(PORTFOLIO_MODE_STORAGE_KEY);
    if (raw === null) return { status: 'first-use' };
    if (isPortfolioMode(raw)) return { status: 'valid', mode: raw };
    return { status: 'invalid', rawValue: raw };
  } catch {
    // Storage inaccessible (private browsing, disabled, quota/security
    // exception on read). This is not "nothing stored" -- it's "cannot be
    // determined" -- so it must resolve the same way an invalid value does:
    // visibly, not silently as LIVE or PAPER.
    return { status: 'invalid', rawValue: null };
  }
}

/**
 * Best-effort write, matching this codebase's existing persistence
 * convention (savePriorityWorkflowState, lib/theme.ts) of swallowing
 * storage write failures (quota, private browsing, disabled storage)
 * rather than throwing into the caller. A failed write only means the
 * selection won't survive a refresh -- the in-memory PortfolioModeProvider
 * state set alongside this call is still correct for the current session.
 */
export function writePersistedPortfolioMode(mode: PortfolioMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PORTFOLIO_MODE_STORAGE_KEY, mode);
  } catch {
    // Best-effort only -- see doc comment above.
  }
}
