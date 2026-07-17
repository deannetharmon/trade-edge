// features/portfolio/decisionReview/DecisionReviewSection.tsx
//
// PI-0008C: Decision Outcome Tracking V1 -- the compact, collapsed "Decision
// Review" section added to Position Intelligence (ticket #5). Mirrors the
// existing Decision Scorecard section's collapsed-by-default toggle pattern
// (see PositionIntelligencePanel.tsx's DecisionScorecard) rather than
// introducing a new interaction style.
//
// This component computes nothing about recommendation quality and reads no
// scoring internals beyond what it needs to snapshot (see
// lib/decision-review/decisionReview.ts's buildEvidenceSnapshot). It cannot
// influence any recommendation -- it only records what already happened.

'use client';

import { useEffect, useState } from 'react';
import { THEMES, Theme } from '@/lib/theme';
import type { PortfolioRecommendation } from '@/lib/portfolio-intelligence';
import {
  createDecisionReview,
  updateDecisionReview,
  TRADER_ACTIONS,
  TRADER_ACTION_LABEL,
  DECISION_OUTCOME_STATUSES,
  DECISION_OUTCOME_STATUS_LABEL,
} from '@/lib/decision-review';
import type { DecisionReview, DecisionOutcomeStatus, TraderAction } from '@/lib/decision-review';

export interface DecisionReviewSectionProps {
  positionId: string;
  symbol: string;
  strategy: string;
  recommendation: PortfolioRecommendation;
  review: DecisionReview | null;
  onSave: (review: DecisionReview) => void;
  th: typeof THEMES[Theme];
}

interface FormState {
  traderAction: TraderAction | '';
  outcomeStatus: DecisionOutcomeStatus;
  realizedPnl: string; // kept as text while editing; parsed on save
  notes: string;
}

function formStateFromReview(review: DecisionReview | null): FormState {
  return {
    traderAction: review?.traderAction ?? '',
    outcomeStatus: review?.outcomeStatus ?? 'PENDING',
    realizedPnl: review?.realizedPnl != null ? String(review.realizedPnl) : '',
    notes: review?.notes ?? '',
  };
}

const selectClass = (th: typeof THEMES[Theme]) =>
  `text-[11px] px-2 py-1 border rounded bg-transparent outline-none ${th.borderLight} ${th.text}`;
const labelClass = (th: typeof THEMES[Theme]) => `text-[10px] uppercase tracking-widest ${th.textFaint} block mb-1`;

export function DecisionReviewSection({ positionId, symbol, strategy, recommendation, review, onSave, th }: DecisionReviewSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [form, setForm] = useState<FormState>(() => formStateFromReview(review));

  // Re-sync the form whenever a different underlying review arrives (e.g.
  // the initial fetch resolves after mount, or the trader is looking at a
  // different position) -- never on every render, only when the review's
  // identity actually changes.
  useEffect(() => {
    setForm(formStateFromReview(review));
  }, [review?.id]);

  const panelId = `decision-review-panel-${positionId}`;
  const buttonId = `decision-review-toggle-${positionId}`;

  function handleSave() {
    const realizedPnl = form.realizedPnl.trim() === '' ? null : Number(form.realizedPnl);
    const patch = {
      traderAction: form.traderAction === '' ? null : form.traderAction,
      outcomeStatus: form.outcomeStatus,
      realizedPnl: Number.isFinite(realizedPnl) ? realizedPnl : null,
      notes: form.notes,
    };
    const next = review
      ? updateDecisionReview(review, patch)
      : createDecisionReview({ positionId, symbol, strategy, recommendation, ...patch });
    onSave(next);
  }

  return (
    <div className={`border-t ${th.border} pt-3`}>
      <button
        type="button"
        id={buttonId}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className={`text-[10px] uppercase tracking-widest ${th.textFaint}`}>Decision Review</span>
        <span className="flex items-center gap-2">
          {review && (
            <span className={`text-[9px] px-1.5 py-0.5 border rounded ${th.borderLight} ${th.textFaint}`}>
              {DECISION_OUTCOME_STATUS_LABEL[review.outcomeStatus]}
            </span>
          )}
          <span
            className={`text-xs ${th.textFaint} transition-transform motion-safe:duration-150 ${expanded ? 'rotate-180' : ''}`}
            aria-hidden="true"
          >
            &#9660;
          </span>
        </span>
      </button>

      <div id={panelId} role="region" aria-labelledby={buttonId} hidden={!expanded} className="mt-2">
        {expanded && (
          <div className="space-y-3">
            {review && (
              <div className={`rounded border px-2 py-1.5 ${th.border}`}>
                <p className={`text-[9px] uppercase tracking-widest ${th.textFaint} mb-1`}>Recommended at the time</p>
                <p className={`text-[11px] font-semibold ${th.text}`}>{review.evidence.label}</p>
                <p className={`text-[10px] ${th.textFaint}`}>
                  Confidence {review.evidence.confidence}
                  {review.evidence.confidenceTier ? ` (${review.evidence.confidenceTier})` : ''}
                  {review.evidence.margin != null ? ` · margin ${review.evidence.margin}` : ''}
                </p>
                {review.evidence.primaryReason && (
                  <p className={`text-[10px] ${th.textFaint} mt-0.5`}>{review.evidence.primaryReason}</p>
                )}
              </div>
            )}

            <div>
              <label className={labelClass(th)} htmlFor={`${panelId}-action`}>Action Taken</label>
              <select
                id={`${panelId}-action`}
                value={form.traderAction}
                onChange={(e) => setForm((f) => ({ ...f, traderAction: e.target.value as TraderAction | '' }))}
                className={selectClass(th)}
              >
                <option value="">Not recorded yet</option>
                {TRADER_ACTIONS.map((action) => (
                  <option key={action} value={action}>{TRADER_ACTION_LABEL[action]}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass(th)} htmlFor={`${panelId}-outcome`}>Outcome Status</label>
              <select
                id={`${panelId}-outcome`}
                value={form.outcomeStatus}
                onChange={(e) => setForm((f) => ({ ...f, outcomeStatus: e.target.value as DecisionOutcomeStatus }))}
                className={selectClass(th)}
              >
                {DECISION_OUTCOME_STATUSES.map((status) => (
                  <option key={status} value={status}>{DECISION_OUTCOME_STATUS_LABEL[status]}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass(th)} htmlFor={`${panelId}-pnl`}>Realized P/L (optional)</label>
              <input
                id={`${panelId}-pnl`}
                type="number"
                inputMode="decimal"
                step="0.01"
                value={form.realizedPnl}
                onChange={(e) => setForm((f) => ({ ...f, realizedPnl: e.target.value }))}
                placeholder="e.g. -280.00"
                className={`${selectClass(th)} w-32`}
              />
            </div>

            <div>
              <label className={labelClass(th)} htmlFor={`${panelId}-notes`}>Notes (optional)</label>
              <textarea
                id={`${panelId}-notes`}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Short note on what happened..."
                rows={2}
                className={`text-[11px] px-2 py-1 border rounded bg-transparent outline-none w-full resize-none ${th.borderLight} ${th.text}`}
              />
            </div>

            <button
              type="button"
              onClick={handleSave}
              className="text-[10px] px-3 py-1 border rounded-lg transition-colors font-bold border-blue-600 text-blue-400 hover:bg-blue-500/10"
            >
              {review ? 'Save Changes' : 'Save Review'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
