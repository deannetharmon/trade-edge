// features/portfolio/decisionReview/DecisionHistoryView.tsx
//
// PI-0008C: Decision Outcome Tracking V1 -- ticket #6's "Decision History"
// Portfolio subpage. A basic list of every saved Decision Review with simple
// status/follow filters. No charts, no analytics, no correctness scoring --
// this view only displays what was already recorded (see
// lib/decision-review/decisionReview.ts's filterDecisionReviews(), which
// this component calls rather than reimplementing filtering logic).

'use client';

import { useMemo, useState } from 'react';
import { THEMES, Theme } from '@/lib/theme';
import {
  allReviewsByRecency,
  filterDecisionReviews,
  TRADER_ACTION_LABEL,
  DECISION_OUTCOME_STATUS_LABEL,
  DECISION_HISTORY_FILTER_LABEL,
} from '@/lib/decision-review';
import type { DecisionHistoryFilter, DecisionReview, DecisionReviewStore } from '@/lib/decision-review';

export interface DecisionHistoryViewProps {
  reviews: DecisionReviewStore;
  th: typeof THEMES[Theme];
}

const FILTERS: DecisionHistoryFilter[] = ['ALL', 'PENDING', 'FAVORABLE', 'UNFAVORABLE', 'FOLLOWED', 'NOT_FOLLOWED'];

function outcomeToneClass(status: DecisionReview['outcomeStatus']): string {
  switch (status) {
    case 'FAVORABLE': return 'text-emerald-400';
    case 'UNFAVORABLE': return 'text-red-400';
    case 'PENDING': return 'text-amber-400';
    default: return '';
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

function formatPnl(pnl: number | null): string {
  if (pnl == null) return '—';
  const sign = pnl > 0 ? '+' : '';
  return `${sign}${pnl.toFixed(2)}`;
}

export function DecisionHistoryView({ reviews, th }: DecisionHistoryViewProps) {
  const [filter, setFilter] = useState<DecisionHistoryFilter>('ALL');

  const sorted = useMemo(() => allReviewsByRecency(reviews), [reviews]);
  const filtered = useMemo(() => filterDecisionReviews(sorted, filter), [sorted, filter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Decision history filters">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`text-[10px] px-2.5 py-1 border rounded-lg font-bold transition-colors ${
              filter === f
                ? 'border-blue-500 text-blue-300 bg-blue-500/10'
                : `${th.borderLight} ${th.textFaint}`
            }`}
          >
            {DECISION_HISTORY_FILTER_LABEL[f]}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className={`text-[12px] ${th.textFaint}`}>No decision reviews match this filter yet.</p>
      ) : (
        <div className={`border rounded-lg overflow-hidden ${th.border}`}>
          <table className="w-full text-left" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr className={`border-b ${th.border}`}>
                <th className={`text-[10px] uppercase tracking-widest ${th.textFaint} px-3 py-2 font-semibold`}>Symbol</th>
                <th className={`text-[10px] uppercase tracking-widest ${th.textFaint} px-3 py-2 font-semibold`}>Recommendation</th>
                <th className={`text-[10px] uppercase tracking-widest ${th.textFaint} px-3 py-2 font-semibold`}>Trader Action</th>
                <th className={`text-[10px] uppercase tracking-widest ${th.textFaint} px-3 py-2 font-semibold`}>Outcome</th>
                <th className={`text-[10px] uppercase tracking-widest ${th.textFaint} px-3 py-2 font-semibold`}>Realized P/L</th>
                <th className={`text-[10px] uppercase tracking-widest ${th.textFaint} px-3 py-2 font-semibold`}>Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((review) => (
                <tr key={review.id} className={`border-b ${th.borderLight} last:border-b-0`}>
                  <td className={`text-[12px] font-semibold ${th.text} px-3 py-2 whitespace-nowrap`}>{review.symbol}</td>
                  <td className={`text-[12px] ${th.textMuted} px-3 py-2 whitespace-nowrap`}>{review.evidence.label}</td>
                  <td className={`text-[12px] ${th.textMuted} px-3 py-2 whitespace-nowrap`}>
                    {review.traderAction ? TRADER_ACTION_LABEL[review.traderAction] : '—'}
                  </td>
                  <td className={`text-[12px] px-3 py-2 whitespace-nowrap font-semibold ${outcomeToneClass(review.outcomeStatus)}`}>
                    {DECISION_OUTCOME_STATUS_LABEL[review.outcomeStatus]}
                  </td>
                  <td className={`text-[12px] ${th.textMuted} px-3 py-2 whitespace-nowrap`} style={{ fontFamily: "'DM Mono', monospace" }}>
                    {formatPnl(review.realizedPnl)}
                  </td>
                  <td className={`text-[11px] ${th.textFaint} px-3 py-2 whitespace-nowrap`}>{formatDate(review.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
