import type { ScanModalTheme } from '../ScanModalShell';

export interface CriterionPill {
  key: string;
  label: string;
  pressed: boolean;
  /** The explicit off state ("Any"): drawn dashed so it never reads as disabled. */
  off?: boolean;
  onSelect: () => void;
}

/**
 * Quick-select pills for one criterion. A group belongs to exactly one criterion, so
 * a click here can never change the selection of another category. Pills are
 * buttons with aria-pressed (not radios), so the mode and preset radiogroups stay
 * the only radios in the dialog.
 */
export function CriterionPills({ th, groupLabel, pills, compact = false }: { th: ScanModalTheme; groupLabel: string; pills: CriterionPill[]; compact?: boolean }) {
  if (pills.length === 0) return null;
  return (
    <div role="group" aria-label={groupLabel} className={`flex flex-wrap ${compact ? 'mt-1 gap-1' : 'mt-2 gap-1.5'}`}>
      {pills.map((pill) => (
        <button
          key={pill.key}
          type="button"
          aria-pressed={pill.pressed}
          data-pill={pill.key}
          onClick={pill.onSelect}
          className={`${compact ? 'rounded-full px-2 py-0.5' : 'rounded-md px-2.5 py-1.5'} border text-[10px] ${pill.off ? 'border-dashed' : ''} ${
            pill.pressed ? 'border-amber-400 bg-amber-400/15 font-bold text-amber-200' : `${th.inputBorder} ${th.textMuted}`
          }`}
        >
          {pill.label}
        </button>
      ))}
    </div>
  );
}
