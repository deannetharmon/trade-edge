// features/portfolio/positions/HealthyMonitoringSection.tsx
//
// WA-0003: Healthy-Monitoring Relocation (CES section 10). Extracted
// verbatim from features/portfolio/dashboard/TodaysPrioritiesDashboard.tsx's
// "Monitor" section (MonitorRow + its collapse-after-6 interaction) -- same
// TodaysPrioritiesMonitorEntry[] input, unchanged meaning. Mounted on
// Positions, above the position list, alongside WA-0002's
// PositionCompositionCard.
//
// Healthy positions remain visible here as monitoring information, not a
// task: no Mark Complete control, never counted in any open-queue count.
// Health/DTE/objective/classification meaning is completely unchanged --
// this reads the exact same TodaysPrioritiesMonitorEntry fields already
// computed by buildTodaysPrioritiesDashboard(), unmodified.

'use client';

import { useState } from 'react';
import { THEMES, Theme } from '@/lib/theme';
import type { TodaysPrioritiesMonitorEntry } from '@/lib/todaysPriorities';

function MonitorRow({ entry, th }: { entry: TodaysPrioritiesMonitorEntry; th: typeof THEMES[Theme] }) {
  return (
    <div className={`flex items-center justify-between rounded-lg border ${th.borderLight} ${th.card} px-3 py-2`}>
      <div className="flex min-w-0 items-center gap-2">
        <span className={`text-[11px] font-semibold ${th.text}`}>{entry.symbol}</span>
        <span className={`text-[10px] ${th.textFaint}`}>{entry.strategy}</span>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className={`text-[10px] ${th.textFaint}`}>{entry.dte}d</span>
        <span className={`text-[10px] font-semibold ${th.textMuted}`}>
          {entry.healthScore !== null ? `${entry.healthScore}` : '—'}
        </span>
      </div>
    </div>
  );
}

export interface HealthyMonitoringSectionProps {
  monitor: TodaysPrioritiesMonitorEntry[];
  th: typeof THEMES[Theme];
}

export function HealthyMonitoringSection({ monitor, th }: HealthyMonitoringSectionProps) {
  const [monitorExpanded, setMonitorExpanded] = useState(false);

  if (monitor.length === 0) return null;

  const visibleMonitor = monitorExpanded ? monitor : monitor.slice(0, 6);

  return (
    <section aria-label="Healthy Position Monitoring" className="mb-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className={`text-[12px] font-bold uppercase tracking-widest ${th.text}`}>Healthy Position Monitoring</h2>
        <span className={`text-[9px] ${th.textFaint}`}>{monitor.length} position{monitor.length !== 1 ? 's' : ''} &mdash; no action needed</span>
      </div>
      <div className="space-y-1.5">
        {visibleMonitor.map((entry) => (
          <MonitorRow key={entry.key} entry={entry} th={th} />
        ))}
        {monitor.length > 6 && (
          <button
            type="button"
            onClick={() => setMonitorExpanded((v) => !v)}
            className={`text-[10px] font-semibold ${th.textFaint} hover:${th.text}`}
          >
            {monitorExpanded ? 'Show less' : `Show all ${monitor.length}`}
          </button>
        )}
      </div>
    </section>
  );
}
