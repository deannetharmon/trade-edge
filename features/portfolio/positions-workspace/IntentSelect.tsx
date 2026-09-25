// features/portfolio/positions-workspace/IntentSelect.tsx
//
// POSITION-INTENT-0001: the per-position intent control, shown in the strategy's own words (LEAP: Hold / PMCC / Undecided;
// lone short put or call: Income / Acquire / Wheel / Neutral; spreads: Income / Neutral; a bought put or short-dated bought call:
// Directional / Hedge / Undecided; shares: Hold / Wheel / Undecided). It edits the one stored value (/api/position-intent).

'use client';

import type { Position, PositionIntent } from '@/lib/portfolio-data/types';
import { INTENT_LABELS, intentFamilyFor, intentOptionsFor, normalizeIntentForFamily, type IntentFamily } from '@/lib/positionIntent/vocabulary';

/** The select itself. `stored` is whatever is saved; it is shown as the family's fallback when it belongs to another vocabulary. */
export function IntentSelectControl({ family, stored, ariaLabel, onChange, className = '' }: {
  family: IntentFamily;
  stored: string | null | undefined;
  ariaLabel: string;
  onChange: (intent: PositionIntent) => void;
  className?: string;
}) {
  return (
    <label className={`inline-flex items-center gap-1 text-[10px] ${className}`} onClick={event => event.stopPropagation()}>
      <span className="text-white/50">Intent</span>
      <select
        aria-label={ariaLabel}
        value={normalizeIntentForFamily(stored, family)}
        onChange={event => onChange(event.target.value as PositionIntent)}
        className="rounded border border-white/15 bg-transparent px-1 py-0.5 text-[10px] text-white/80 focus:outline-none focus:ring-2 focus:ring-teal-400"
      >
        {intentOptionsFor(family).map(option => <option key={option} value={option} className="bg-slate-900">{INTENT_LABELS[option]}</option>)}
      </select>
    </label>
  );
}

/** An option position's control; renders nothing for a structure with no vocabulary or when there is no handler. */
export function IntentSelect({ position, onIntentChange, className = '' }: {
  position: Position;
  onIntentChange?: (key: string, intent: PositionIntent) => void;
  className?: string;
}) {
  const family = intentFamilyFor(position);
  if (!family || !onIntentChange) return null;
  return <IntentSelectControl family={family} stored={position.intent} ariaLabel={`Intent for ${position.symbol}`} onChange={intent => onIntentChange(position.key, intent)} className={className} />;
}
