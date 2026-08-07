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

import type { ReactNode } from 'react';

export type LauncherStrategyId = 'spreads' | 'csp' | 'cc' | 'pmcc';

interface LauncherColorSet {
  /** Transparent background, strategy-colored border + text, subtle hover tint. */
  unselected: string;
  /** Solid strategy-colored background, white text, strong border. */
  selected: string;
  /** Ring color used only on the selected state, for the "not color alone" cue. */
  selectedRing: string;
}

// Spreads uses the app's dynamic --accent variable (lib/theme.ts's
// ac-btn / ac-btn-solid utility classes) since its color is user-themeable,
// not a fixed palette color the way CSP/CC/PMCC are.
const LAUNCHER_COLORS: Record<LauncherStrategyId, LauncherColorSet> = {
  spreads: {
    unselected: 'ac-btn bg-transparent',
    selected: 'ac-btn-solid text-white',
    selectedRing: 'ring-white/70',
  },
  csp: {
    unselected: 'bg-transparent border-amber-500 text-amber-400 hover:bg-amber-500/10',
    selected: 'bg-amber-500 border-amber-500 text-white',
    selectedRing: 'ring-amber-300/70',
  },
  cc: {
    unselected: 'bg-transparent border-cyan-500 text-cyan-400 hover:bg-cyan-500/10',
    selected: 'bg-cyan-500 border-cyan-500 text-white',
    selectedRing: 'ring-cyan-300/70',
  },
  pmcc: {
    unselected: 'bg-transparent border-purple-500 text-purple-400 hover:bg-purple-500/10',
    selected: 'bg-purple-500 border-purple-500 text-white',
    selectedRing: 'ring-purple-300/70',
  },
};

export interface LauncherButtonProps {
  strategy: LauncherStrategyId;
  /** Accessible/visible label identifying the strategy (e.g. "FIND SPREADS"). */
  label: string;
  /** Rendered button text -- may differ from `label` while loading ("SCANNING..."). */
  children: ReactNode;
  isSelected: boolean;
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
  onClick,
  disabled,
  title,
  className = '',
}: LauncherButtonProps) {
  const colors = LAUNCHER_COLORS[strategy];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={isSelected}
      // Deliberately stable and NOT selected/loading-dependent: existing
      // Screener tests query these buttons by exact accessible name (e.g.
      // getByRole('button', { name: 'FIND CSPs' })), and the strategy must
      // stay identifiable even while the visible text becomes
      // "SCANNING...". Selected-state is communicated via aria-pressed
      // (the standard mechanism for this), never by mutating the name.
      aria-label={label}
      className={`relative text-[10px] font-bold tracking-widest py-2 rounded-lg border-2 transition-colors disabled:opacity-40 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a] ${
        isSelected ? `${colors.selected} ring-2 ring-offset-1 ring-offset-[#0a0a0a] ${colors.selectedRing}` : colors.unselected
      } ${className}`}
    >
      {/* Non-color selected-state cue, per the requirement that selection
          must be understandable without color. */}
      {isSelected && (
        <span aria-hidden="true" className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[9px] font-bold">
          ✓
        </span>
      )}
      {children}
    </button>
  );
}
