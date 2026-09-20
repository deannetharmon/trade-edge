// components/dashboard/DashboardParts.tsx
//
// Shared presentational pieces for the dashboard-style views (LEAPS analysis, advisor cards, Positions income card):
// tone colours, a tile grid, and a callout list. No data or rules live here -- the numbers, tones and sentences are
// produced by pure builders in lib/ (lib/leaps-analysis/dashboard.ts, lib/leaps-position-intelligence/incomeCard.ts).

import type { DashboardCallout, DashboardTile, DashboardTone } from '@/lib/leaps-analysis/dashboard';

export const TEXT: Record<DashboardTone, string> = { good: 'text-emerald-400', watch: 'text-amber-300', bad: 'text-red-400', neutral: 'text-neutral-400' };
export const BORDER: Record<DashboardTone, string> = { good: 'border-emerald-500/40', watch: 'border-amber-500/40', bad: 'border-red-500/50', neutral: 'border-neutral-700' };
export const FILL: Record<DashboardTone, string> = { good: 'bg-emerald-500/10', watch: 'bg-amber-500/10', bad: 'bg-red-500/10', neutral: 'bg-neutral-800/40' };
export const ICON: Record<DashboardTone, string> = { good: '✓', watch: '⚠', bad: '✗', neutral: '•' };
export const LABEL: Record<DashboardTone, string> = { good: 'Good', watch: 'Watch', bad: 'Problem', neutral: 'Note' };

/** Short callouts, each with an icon and a screen-reader label. */
export function CalloutList({ callouts, th, compact = false }: { callouts: DashboardCallout[]; th: { text: string }; compact?: boolean }) {
  if (callouts.length === 0) return null;
  return (
    <ul className={compact ? 'flex flex-wrap gap-1.5' : 'space-y-1.5'}>
      {callouts.map(callout => (
        <li key={callout.id} className={`flex items-start gap-2 border text-[11px] ${compact ? 'rounded-full px-2.5 py-1' : 'rounded-lg px-3 py-2'} ${BORDER[callout.tone]} ${FILL[callout.tone]}`}>
          <span aria-hidden="true" className={TEXT[callout.tone]}>{ICON[callout.tone]}</span>
          <span className="sr-only">{LABEL[callout.tone]}:</span>
          <span className={th.text}>{callout.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** A grid of number tiles: label, value, and short coloured notes underneath. */
export function TileGrid({ tiles, th, columnsClass = 'grid-cols-2 md:grid-cols-4' }: { tiles: DashboardTile[]; th: { text: string }; columnsClass?: string }) {
  return (
    <div className={`grid gap-2 ${columnsClass}`}>
      {tiles.map(tile => (
        <div key={tile.id} className={`rounded-lg border p-2 ${BORDER[tile.tone]} bg-neutral-900/60`}>
          <div className="text-[9px] uppercase tracking-wider text-neutral-400">{tile.label}</div>
          <div className={`mt-0.5 font-mono text-lg font-semibold ${th.text}`}>{tile.value}</div>
          <div className="mt-0.5 text-[10px]">
            {tile.parts.map((part, index) => (
              <span key={index} className={TEXT[part.tone]}>{index > 0 && <span className="text-neutral-500"> · </span>}{part.text}</span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
