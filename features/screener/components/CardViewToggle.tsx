// features/screener/components/CardViewToggle.tsx

'use client';

import { useCardView, writeCardView, type CardView } from '../lib/useCardView';

/** Clean / Full switch for result cards. */
export function CardViewToggle() {
  const view = useCardView();
  const opt = (v: CardView, label: string) => (
    <button type="button" role="radio" aria-checked={view === v} onClick={() => writeCardView(v)}
      className={`min-h-[44px] px-4 text-xs font-bold ${view === v ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
      {label}
    </button>
  );
  return (
    <div role="radiogroup" aria-label="Card view" data-testid="card-view-toggle"
      className="inline-flex overflow-hidden rounded-lg border border-slate-600/60">
      {opt('clean', 'Clean')}{opt('full', 'Full')}
    </div>
  );
}
