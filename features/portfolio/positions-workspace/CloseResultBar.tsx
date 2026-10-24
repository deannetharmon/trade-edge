// features/portfolio/positions-workspace/CloseResultBar.tsx
//
// One visual for "what closing would realize": a big result number and a bar of how much of what was paid comes back. Used for each held LEAPS
// and for the all-LEAPS total, so both read the same way.

import { SEMANTIC_TONE_CLASS } from './model/presentation';

export const usd0 = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

export function CloseResultBar({ caption, paid, back, borderClass, faintClass, testId }: { caption: string; paid: number; back: number; borderClass: string; faintClass: string; testId?: string }) {
  const result = Math.round((back - paid) * 100) / 100;
  const loss = result < 0;
  const pct = paid > 0 ? (result / paid) * 100 : null;
  const backPct = Math.max(0, Math.min(100, paid > 0 ? (back / paid) * 100 : 0));
  return (
    <div data-testid={testId} aria-label={`${caption}: ${usd0(result)}`} className={`mt-3 flex flex-wrap items-center gap-4 rounded border ${borderClass} px-3 py-2`}>
      <div className="min-w-[8rem]">
        <div className={`text-xl font-bold ${loss ? SEMANTIC_TONE_CLASS.negative : SEMANTIC_TONE_CLASS.positive}`}>{usd0(result)}</div>
        <div className={`text-[10px] ${faintClass}`}>{caption}{pct != null ? ` · ${pct.toFixed(0)}%` : ''}</div>
      </div>
      <div className="min-w-[14rem] flex-1">
        <div className={`flex h-3 overflow-hidden rounded-full ${loss ? 'bg-red-500/70' : 'bg-emerald-400/30'}`} role="img" aria-label={`${usd0(back)} back of ${usd0(paid)} paid`}>
          <div className="h-full bg-emerald-400/80" style={{ width: `${loss ? backPct : 100}%` }} />
        </div>
        <div className={`mt-1 flex justify-between text-[10px] ${faintClass}`}><span>{usd0(back)} back</span><span>{usd0(paid)} paid</span></div>
      </div>
    </div>
  );
}
