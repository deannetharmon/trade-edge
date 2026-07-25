// features/portfolio/decisionReview/DecisionHistoryView.tsx
//
// PI-0008C: Decision Outcome Tracking V1 -- ticket #6's "Decision History"
// Portfolio subpage. A basic list of every saved Decision Review with simple
// status/follow filters. No charts, no analytics, no correctness scoring --
// this view only displays what was already recorded (see
// lib/decision-review/decisionReview.ts's filterDecisionReviews(), which
// this component calls rather than reimplementing filtering logic).
//
// PI-0008D: adds the "Needs Follow-Up" filter and per-row badge -- reminder
// only. isReviewNeedingFollowUp() is a mechanical read of outcomeStatus vs.
// the caller-supplied open-position set; nothing here infers Favorable/
// Unfavorable/Neutral, computes realized P/L, or touches Autopilot/Trade Log.
//
// PI-0009B: adds a compact, read-only "Analysis" column -- the automatic
// recommendation-accuracy evaluation from lib/decision-review/
// outcomeAnalysis.ts, computed fresh from whatever closedTrades/snapshotStore
// the caller supplies (both optional; with neither, this column just shows
// "—" for every row, identical to before this ticket). This is entirely
// separate from the Outcome column above -- that remains the trader's own
// manual FAVORABLE/UNFAVORABLE/NEUTRAL judgment, untouched by this.

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { THEMES, Theme } from '@/lib/theme';
import {
  allReviewsByRecency,
  filterDecisionReviews,
  isReviewNeedingFollowUp,
  analyzeAllDecisionOutcomes,
  DECISION_OUTCOME_ACCURACY_LABEL,
  TRADER_ACTION_LABEL,
  DECISION_OUTCOME_STATUS_LABEL,
  DECISION_HISTORY_FILTER_LABEL,
} from '@/lib/decision-review';
import type { DecisionHistoryFilter, DecisionReview, DecisionReviewStore, PositionIdSet, DecisionOutcomeAccuracy } from '@/lib/decision-review';
import type { PositionSnapshotStore } from '@/lib/position-snapshot';
import type { ClosedTrade } from '@/lib/tradeLog/reconstructTrades';

export interface DecisionHistoryViewProps {
  reviews: DecisionReviewStore;
  // PI-0008D: the trader's current open-position ids. Defaults to empty --
  // with no open-position set supplied, every Pending review is treated as
  // needing follow-up (the safe default; see decisionReview.ts's doc
  // comment on filterDecisionReviews()).
  openPositionIds?: PositionIdSet;
  // PI-0009B: optional -- if either is omitted, the Analysis column simply
  // has nothing to match against and shows "—" for every row.
  closedTrades?: ClosedTrade[];
  snapshotStore?: PositionSnapshotStore;
  // WA-0003 (CES section 13.2, level-2 deep link): exact DecisionReview.id
  // to highlight and scroll to on mount. Optional -- omitted, this
  // component's rendering is byte-identical to before.
  focusReviewId?: string | null;
  th: typeof THEMES[Theme];
}

function accuracyToneClass(accuracy: DecisionOutcomeAccuracy): string {
  switch (accuracy) {
    case 'CORRECT': return 'text-emerald-400 border-emerald-600 bg-emerald-500/10';
    case 'INCORRECT': return 'text-red-400 border-red-600 bg-red-500/10';
    default: return 'text-slate-400 border-slate-600 bg-slate-500/10';
  }
}

const FILTERS: DecisionHistoryFilter[] = ['ALL', 'PENDING', 'FAVORABLE', 'UNFAVORABLE', 'FOLLOWED', 'NOT_FOLLOWED', 'NEEDS_FOLLOW_UP'];

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

export function DecisionHistoryView({ reviews, openPositionIds = [], closedTrades = [], snapshotStore = {}, focusReviewId = null, th }: DecisionHistoryViewProps) {
  const [filter, setFilter] = useState<DecisionHistoryFilter>('ALL');
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());

  useEffect(() => {
    if (!focusReviewId) return;
    const el = rowRefs.current.get(focusReviewId);
    el?.scrollIntoView?.({ block: 'center' });
  }, [focusReviewId]);

  const sorted = useMemo(() => allReviewsByRecency(reviews), [reviews]);
  const filtered = useMemo(
    () => filterDecisionReviews(sorted, filter, openPositionIds),
    [sorted, filter, openPositionIds],
  );
  // PI-0009B: recomputed whenever the inputs change; nothing here is
  // persisted -- see outcomeAnalysis.ts's module doc.
  const outcomeAnalyses = useMemo(
    () => analyzeAllDecisionOutcomes(reviews, snapshotStore, closedTrades),
    [reviews, snapshotStore, closedTrades],
  );

  const focusTargetMissing = focusReviewId != null && !sorted.some((r) => r.id === focusReviewId);

  return (
    <div className="space-y-4">
      {focusTargetMissing && (
        <div role="status" className="rounded-lg border border-amber-600/60 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
          The decision review this link pointed to could not be found.
        </div>
      )}
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
                <th className={`text-[10px] uppercase tracking-widest ${th.textFaint} px-3 py-2 font-semibold`}>Analysis</th>
                <th className={`text-[10px] uppercase tracking-widest ${th.textFaint} px-3 py-2 font-semibold`}>Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((review) => (
                <tr
                  key={review.id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(review.id, el);
                    else rowRefs.current.delete(review.id);
                  }}
                  className={`border-b ${th.borderLight} last:border-b-0 ${focusReviewId === review.id ? 'ring-2 ring-inset ring-[var(--accent)]' : ''}`}
                >
                  <td className={`text-[12px] font-semibold ${th.text} px-3 py-2 whitespace-nowrap`}>{review.symbol}</td>
                  <td className={`text-[12px] ${th.textMuted} px-3 py-2 whitespace-nowrap`}>{review.evidence.label}</td>
                  <td className={`text-[12px] ${th.textMuted} px-3 py-2 whitespace-nowrap`}>
                    {review.traderAction ? TRADER_ACTION_LABEL[review.traderAction] : '—'}
                  </td>
                  <td className={`text-[12px] px-3 py-2 whitespace-nowrap font-semibold ${outcomeToneClass(review.outcomeStatus)}`}>
                    {DECISION_OUTCOME_STATUS_LABEL[review.outcomeStatus]}
                    {isReviewNeedingFollowUp(review, openPositionIds) && (
                      <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded border border-amber-500/60 bg-amber-500/10 text-amber-400 font-bold whitespace-nowrap">
                        Needs Follow-Up
                      </span>
                    )}
                  </td>
                  <td className={`text-[12px] ${th.textMuted} px-3 py-2 whitespace-nowrap`} style={{ fontFamily: "'DM Mono', monospace" }}>
                    {formatPnl(review.realizedPnl)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {outcomeAnalyses[review.id] ? (
                      <span
                        title={outcomeAnalyses[review.id].explanation}
                        className={`text-[9px] px-1.5 py-0.5 border rounded font-bold ${accuracyToneClass(outcomeAnalyses[review.id].recommendationAccuracy)}`}
                      >
                        {DECISION_OUTCOME_ACCURACY_LABEL[outcomeAnalyses[review.id].recommendationAccuracy]}
                      </span>
                    ) : (
                      <span className={`text-[11px] ${th.textFaint}`}>—</span>
                    )}
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
