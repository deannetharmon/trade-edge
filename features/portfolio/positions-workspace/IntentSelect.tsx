// features/portfolio/positions-workspace/IntentSelect.tsx
//
// POSITION-INTENT-0001: the per-position intent control, shown in the strategy's own words (LEAP: Hold / PMCC /
// Undecided; lone short put or call: Income / Acquire / Wheel / Neutral; spreads: Income / Neutral). It edits the one
// stored value (/api/position-intent). Renders nothing where intent means nothing (a bought put, a short-dated bought call).

'use client';

import type { Position, PositionIntent } from '@/lib/portfolio-data/types';
import { INTENT_LABELS, intentFamilyFor, intentOptionsFor, normalizeIntentForFamily } from '@/lib/positionIntent/vocabulary';

export function IntentSelect({ position, onIntentChange, className = '' }: {
  position: Position;
  onIntentChange?: (key: string, intent: PositionIntent) => void;
  className?: string;
}) {
  const family = intentFamilyFor(position);
  if (!family || !onIntentChange) return null;
  const value = normalizeIntentForFamily(position.intent, family);
  return (
    <label className={`inline-flex items-center gap-1 text-[10px] ${className}`} onClick={event => event.stopPropagation()}>
      <span className="text-white/50">Intent</span>
      <select
        aria-label={`Intent for ${position.symbol}`}
        value={value}
        onChange={event => onIntentChange(position.key, event.target.value as PositionIntent)}
        className="rounded border border-white/15 bg-transparent px-1 py-0.5 text-[10px] text-white/80 focus:outline-none focus:ring-2 focus:ring-teal-400"
      >
        {intentOptionsFor(family).map(option => <option key={option} value={option} className="bg-slate-900">{INTENT_LABELS[option]}</option>)}
      </select>
    </label>
  );
}
