// features/screener/components/LauncherButton.tsx
//
// SCREENER-LAUNCHER-0001 — one consistent visual model for every enabled
// strategy-launch button (FIND SPREADS / FIND CSPs / FIND COVERED CALLS /
// FIND PMCCs), replacing four separately drifting conditional class
// strings (FIND SPREADS was permanently solid-filled regardless of
// selection; the other three only ever got a translucent tint + ring).
//
// Selection is never tracked here or anywhere new -- the caller passes
// `isSelected`, which app/screener/page.tsx computes as
// `activeSession?.requestedStrategy === strategy` and nothing else (never
// screenMode, hover, focus, or the last-clicked element). This component
// only renders that boolean; it has no state of its own.
//
// Corrective pass — production defect: every launcher's visible text was
// `loading ? 'SCANNING...' : label`, driven by the page-wide `loading`
// Boolean. That falsely showed all four buttons as "SCANNING..." whenever
// ANY one scan was running. `isRunning` now identifies -- per the caller --
// whether THIS SPECIFIC launcher's own scan invocation is the one running
// (page.tsx derives it from `activeSession?.status === 'running' &&
// activeSession.requestedStrategy === strategy`, itself already the
// canonical, stale-session-safe source of truth -- no new mutable state was
// introduced). Only the running launcher ever renders "SCANNING...";
// `children` (the caller-supplied label/SCANNING text) is passed through
// unchanged, so this component doesn't own that text swap either.
//
// Same pass also corrected the selected visual: the previous strategy-
// colored solid fill + persistent ring + overlapping checkmark is replaced
// with the single, strategy-independent "solid white / black text / white
// border" treatment used for BOTH the idle-selected and actively-running
// states (the ticket's "Actively scanning" state reuses "Selected and
// idle/completed" styling exactly). No permanent ring; only the standard
// keyboard focus-visible ring remains.

import type { ReactNode } from 'react';

export type LauncherStrategyId = 'spreads' | 'csp' | 'cc' | 'pmcc';

interface LauncherColorSet {
  /** Transparent background, strategy-colored border + text, subtle hover tint. */
  unselected: string;
}

// Spreads uses the app's dynamic --accent variable (lib/theme.ts's ac-btn
// utility class) since its color is user-themeable, not a fixed palette
// color the way CSP/CC/PMCC are. Only the UNSELECTED treatment is
// strategy-colored now -- selected/running is always white/black,
// strategy-independent (see module header).
const LAUNCHER_COLORS: Record<LauncherStrategyId, LauncherColorSet> = {
  spreads: { unselected: 'ac-btn bg-transparent' },
  csp: { unselected: 'bg-transparent border-amber-500 text-amber-400 hover:bg-amber-500/10' },
  cc: { unselected: 'bg-transparent border-cyan-500 text-cyan-400 hover:bg-cyan-500/10' },
  pmcc: { unselected: 'bg-transparent border-purple-500 text-purple-400 hover:bg-purple-500/10' },
};

// Selected AND running share this one treatment -- strategy-independent by
// design (the ticket's explicit correction: no more strategy-colored
// selected fills). No ring here; focus visibility is handled entirely by
// focus-visible in the base className below, so it never persists once
// focus moves away.
const SELECTED_OR_RUNNING = 'bg-white border-white text-black';

export interface LauncherButtonProps {
  strategy: LauncherStrategyId;
  /** Accessible/visible label identifying the strategy (e.g. "FIND SPREADS"). */
  label: string;
  /** Rendered button text -- may differ from `label` while THIS launcher's
   * own scan is running ("SCANNING..."). Caller decides this from
   * `isRunning`, not this component. */
  children: ReactNode;
  isSelected: boolean;
  /** True only when this specific launcher's own scan invocation is the one
   * currently running -- never derived from a page-wide loading flag (see
   * module header). Drives `aria-busy` and reuses the selected white/black
   * treatment; does not affect `aria-pressed`. */
  isRunning?: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
}

export function LauncherButton({
  strategy,
  label,
  children,
  isSelected,
  isRunning = false,
  onClick,
  disabled,
  title,
  className = '',
}: LauncherButtonProps) {
  const colors = LAUNCHER_COLORS[strategy];
  const showSelectedTreatment = isSelected || isRunning;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={isSelected}
      // aria-busy is set only on the one launcher actually running --
      // never on the other three, which is the whole point of this
      // corrective pass (previously all four looked and read as scanning).
      aria-busy={isRunning}
      // Deliberately stable and NOT selected/running-dependent: existing
      // Screener tests query these buttons by exact accessible name (e.g.
      // getByRole('button', { name: 'FIND CSPs' })), and the strategy must
      // stay identifiable even while the visible text becomes
      // "SCANNING...". Selected-state is communicated via aria-pressed and
      // running-state via aria-busy -- never by mutating the name.
      aria-label={label}
      className={`text-[10px] font-bold tracking-widest py-2 rounded-lg border-2 transition-colors disabled:opacity-40 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a] ${
        showSelectedTreatment ? SELECTED_OR_RUNNING : colors.unselected
      } ${className}`}
    >
      {children}
    </button>
  );
}
