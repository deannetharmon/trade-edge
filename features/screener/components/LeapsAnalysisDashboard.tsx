// features/screener/components/LeapsAnalysisDashboard.tsx
//
// LEAPS-DASH-0001 -- renders the rule-computed dashboard for "Analyze with AI": chips, rule line, six tiles, callouts.
// Purely presentational: every number and sentence comes from buildLeapsDashboard (lib/leaps-analysis/dashboard.ts).

import type { LeapsDashboard } from '@/lib/leaps-analysis/dashboard';

// Tone colours and the callout list are shared with the advisor cards and the Positions income card.
import { CalloutList, TEXT, BORDER, FILL } from '@/components/dashboard/DashboardParts';
export { CalloutList, TEXT, BORDER, FILL, ICON, LABEL } from '@/components/dashboard/DashboardParts';

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
