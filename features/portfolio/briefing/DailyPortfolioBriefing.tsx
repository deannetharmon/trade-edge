// features/portfolio/briefing/DailyPortfolioBriefing.tsx
//
// PI-0004D: the Daily Portfolio Briefing -- the Portfolio page's default
// subpage. "What do I need to know before the market opens?", read in about
// 30 seconds: Portfolio Health, Today's Priorities (reused, unmodified),
// Portfolio Summary, What Changed (only when there's something to report),
// and a single closing Suggested Focus line.
//
// This component evaluates nothing. Every judgment shown here is a pure
// aggregation of the canonical `objectives` list Portfolio Intelligence
// already computed -- see portfolioHealth.ts / portfolioSummary.ts /
// suggestedFocus.ts / whatChanged.ts, none of which import or duplicate any
// Portfolio Intelligence evaluation or ranking function.

'use client';

import { useEffect, useState } from 'react';
import { THEMES, Theme } from '@/lib/theme';
import type { PortfolioObjective } from '@/lib/portfolio-intelligence';
import { TodaysPrioritiesWorkflow } from '../components/TodaysPrioritiesWorkflow';
import { derivePortfolioHealth, type PortfolioHealthLevel } from './portfolioHealth';
import { derivePortfolioSummary } from './portfolioSummary';
import { deriveSuggestedFocus } from './suggestedFocus';
import {
  buildBriefingSnapshot,
  computeWhatChanged,
  loadBriefingSnapshot,
  saveBriefingSnapshot,
  type WhatChangedEntry,
} from './whatChanged';

export interface DailyPortfolioBriefingProps {
  objectives: PortfolioObjective[] | null;
  loading: boolean;
  th: typeof THEMES[Theme];
}

const HEALTH_STYLE: Record<PortfolioHealthLevel, { border: string; bg: string; text: string }> = {
  healthy: { border: 'border-emerald-600/50', bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
  attention: { border: 'border-amber-600/50', bg: 'bg-amber-500/10', text: 'text-amber-400' },
  action: { border: 'border-red-600/50', bg: 'bg-red-500/10', text: 'text-red-400' },
};

const WHAT_CHANGED_LABEL: Record<WhatChangedEntry['kind'], string> = {
  new: 'New',
  changed: 'Changed',
  resolved: 'Resolved',
};

export function DailyPortfolioBriefing({ objectives, loading, th }: DailyPortfolioBriefingProps) {
  const [changes, setChanges] = useState<WhatChangedEntry[]>([]);

  // Diff against the previously stored snapshot, then persist this
  // refresh's snapshot -- in that order, so the diff always compares
  // against what was there *before* this refresh.
  useEffect(() => {
    if (!objectives) return;
    const previous = loadBriefingSnapshot();
    setChanges(computeWhatChanged(objectives, previous));
    saveBriefingSnapshot(buildBriefingSnapshot(objectives));
  }, [objectives]);

  if (objectives === null) {
    if (!loading) return null;
    return (
      <section className="mx-6 mt-4" aria-label="Daily Portfolio Briefing">
        <div className={`rounded-xl border ${th.border} ${th.card} p-6 text-center`}>
          <p className={`text-[11px] ${th.textFaint}`}>Loading briefing&hellip;</p>
        </div>
      </section>
    );
  }

  const health = derivePortfolioHealth(objectives);
  const healthStyle = HEALTH_STYLE[health.level];
  const summary = derivePortfolioSummary(objectives);
  const focus = deriveSuggestedFocus(objectives);

  return (
    <div className="mx-6 mt-4 mb-8 space-y-6" aria-label="Daily Portfolio Briefing">
      <section
        aria-label="Portfolio Health"
        className={`flex items-center gap-3 rounded-xl border p-4 ${healthStyle.border} ${healthStyle.bg}`}
      >
        <span className="text-2xl leading-none" aria-hidden="true">{health.emoji}</span>
        <p className={`text-sm font-bold tracking-wide ${healthStyle.text}`}>{health.label}</p>
      </section>

      <TodaysPrioritiesWorkflow objectives={objectives} loading={loading} th={th} />

      <section aria-label="Portfolio Summary">
        <h2 className={`text-[11px] font-bold uppercase tracking-widest ${th.textFaint} mb-2`}>Portfolio Summary</h2>
        <ul className={`space-y-1 rounded-xl border ${th.border} ${th.card} p-4`}>
          {summary.map((line) => (
            <li key={line} className={`text-[12px] ${th.textMuted}`}>{line}</li>
          ))}
        </ul>
      </section>

      {changes.length > 0 && (
        <section aria-label="What Changed">
          <h2 className={`text-[11px] font-bold uppercase tracking-widest ${th.textFaint} mb-2`}>What Changed</h2>
          <ul className={`space-y-1.5 rounded-xl border ${th.border} ${th.card} p-4`}>
            {changes.map((c) => (
              <li key={c.id} className={`text-[12px] ${th.textMuted}`}>
                <span className={`text-[9px] font-bold uppercase tracking-widest ${th.textFaint} mr-2`}>{WHAT_CHANGED_LABEL[c.kind]}</span>
                {c.label}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Suggested Focus">
        <h2 className={`text-[11px] font-bold uppercase tracking-widest ${th.textFaint} mb-2`}>Suggested Focus</h2>
        <div className={`rounded-xl border ${th.border} ${th.card} p-4`}>
          <p className={`text-[13px] font-semibold ${th.text}`}>{focus}</p>
        </div>
      </section>
    </div>
  );
}
