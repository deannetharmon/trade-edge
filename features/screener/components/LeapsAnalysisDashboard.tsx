// features/screener/components/LeapsAnalysisDashboard.tsx
//
// LEAPS-DASH-0001 -- renders the rule-computed dashboard for "Analyze with AI": chips, rule line, six tiles, callouts.
// Purely presentational: every number and sentence comes from buildLeapsDashboard (lib/leaps-analysis/dashboard.ts).

import type { DashboardCallout, DashboardTone, LeapsDashboard } from '@/lib/leaps-analysis/dashboard';

export const TEXT: Record<DashboardTone, string> = { good: 'text-emerald-400', watch: 'text-amber-300', bad: 'text-red-400', neutral: 'text-neutral-400' };
export const BORDER: Record<DashboardTone, string> = { good: 'border-emerald-500/40', watch: 'border-amber-500/40', bad: 'border-red-500/50', neutral: 'border-neutral-700' };
export const FILL: Record<DashboardTone, string> = { good: 'bg-emerald-500/10', watch: 'bg-amber-500/10', bad: 'bg-red-500/10', neutral: 'bg-neutral-800/40' };
export const ICON: Record<DashboardTone, string> = { good: '✓', watch: '⚠', bad: '✗', neutral: '•' };
export const LABEL: Record<DashboardTone, string> = { good: 'Good', watch: 'Watch', bad: 'Problem', neutral: 'Note' };

export function LeapsAnalysisDashboard({ dashboard, th }: { dashboard: LeapsDashboard; th: { text: string; textMuted: string } }) {
  return (
    <div className="space-y-3" data-testid="leaps-analysis-dashboard">
      <div className="flex flex-wrap items-center gap-2">
        {dashboard.chips.map(chip => (
          <span key={chip.id} className={`rounded border px-2 py-0.5 text-[10px] font-bold ${TEXT[chip.tone]} ${BORDER[chip.tone]} ${FILL[chip.tone]}`}>{chip.text}</span>
        ))}
      </div>
      {dashboard.ruleLine && <p className={`text-[10px] ${th.textMuted}`}>{dashboard.ruleLine}</p>}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {dashboard.tiles.map(tile => (
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
      <CalloutList callouts={dashboard.callouts} th={th} />
    </div>
  );
}

/** Short callouts, each with an icon and a screen-reader label; shared by the analysis dashboard and the advisor cards. */
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
