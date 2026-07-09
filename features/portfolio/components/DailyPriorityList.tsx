// features/portfolio/components/DailyPriorityList.tsx
'use client';

import type { PriorityItem } from '../priorities/priority-types';
import type { PortfolioRecommendationUrgency } from '../recommendations/recommendation-types';

const urgencyClass: Record<PortfolioRecommendationUrgency, string> = {
  low: 'border-slate-500/60 bg-slate-500/10 text-slate-300',
  medium: 'border-amber-500/60 bg-amber-500/10 text-amber-300',
  high: 'border-orange-500/60 bg-orange-500/10 text-orange-300',
  critical: 'border-red-500/60 bg-red-500/10 text-red-300',
};

const urgencyDot: Record<PortfolioRecommendationUrgency, string> = {
  low: 'bg-slate-400',
  medium: 'bg-amber-400',
  high: 'bg-orange-400',
  critical: 'bg-red-400',
};

export function DailyPriorityList({
  items,
  onSelect,
}: {
  items: PriorityItem[];
  onSelect?: (positionId: string) => void;
}) {
  if (!items || items.length === 0) return null;

  return (
    <div className="mx-6 mt-4 rounded-lg border border-white/10 bg-white/[0.02] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[11px] font-bold uppercase tracking-widest text-white/60">
          Today&apos;s Priorities
        </h2>
        <span className="text-[9px] text-white/30">Top {items.length}</span>
      </div>

      <ol className="space-y-1.5">
        {items.map(item => (
          <li key={item.positionId}>
            <button
              type="button"
              onClick={onSelect ? () => onSelect(item.positionId) : undefined}
              className={`flex w-full items-center gap-3 rounded px-2 py-1.5 text-left transition-colors ${
                onSelect ? 'hover:bg-white/5 cursor-pointer' : 'cursor-default'
              }`}
            >
              <span className="w-4 shrink-0 text-center text-[11px] font-bold text-white/40">
                {item.rank}
              </span>

              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${urgencyDot[item.urgency]}`} />

              <span className="w-16 shrink-0 font-mono text-xs font-bold text-white">
                {item.symbol}
              </span>

              <span
                className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[9px] font-semibold tracking-wide ${urgencyClass[item.urgency]}`}
              >
                {item.recommendationLabel.toUpperCase()}
              </span>

              <span className="min-w-0 flex-1 truncate text-[10px] text-white/50">
                {item.reason}
              </span>

              <span className="w-8 shrink-0 text-right font-mono text-[10px] text-white/40">
                {item.score}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
