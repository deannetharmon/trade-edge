// features/screener/components/CspScoreBreakdown.tsx

import React from 'react';
import type { CspScoreResult } from '@/lib/scans/cspScore';
import { buildCspScoreRows, cspScoreMaxPoints, type CspScoreDisplayValues } from '@/lib/scans/cspScoreBreakdown';
import { SCORE_BAND_LABEL, type ScoreBand } from '@/lib/scans/scoreBands';

export const SCORE_BAND_CLASS: Record<ScoreBand, string> = {
  green: 'text-emerald-400 border-emerald-500 bg-emerald-500/10',
  yellow: 'text-yellow-400 border-yellow-500 bg-yellow-500/10',
  orange: 'text-orange-400 border-orange-500 bg-orange-500/10',
  red: 'text-red-400 border-red-500 bg-red-500/10',
};

export const SCORE_BAND_BORDER_L: Record<ScoreBand, string> = {
  green: 'border-l-4 border-l-emerald-500',
  yellow: 'border-l-4 border-l-yellow-400',
  orange: 'border-l-4 border-l-orange-400',
  red: 'border-l-4 border-l-red-500',
};

interface BadgeProps {
  score: number;
  band: ScoreBand;
  open: boolean;
  onToggle: () => void;
  /** Set when the return cap held a Strong score at Acceptable. */
  capNote?: string | null;
}

/** "CSP Score 74 | Details" -- colored by quality band, never by strategy. */
export function CspScoreBadge({ score, band, open, onToggle, capNote }: BadgeProps) {
  return (
    <button
      type="button"
      data-testid="csp-score-badge"
      aria-expanded={open}
      aria-label={`CSP Score ${score}, ${SCORE_BAND_LABEL[band]}. ${open ? 'Hide' : 'Show'} score breakdown`}
      title={`CSP Score ${score} (${SCORE_BAND_LABEL[band]})${capNote ? `. ${capNote}` : ''}`}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      className={`text-[10px] px-2 py-0.5 border rounded-md shrink-0 font-bold flex items-center gap-2 ${SCORE_BAND_CLASS[band]}`}
    >
      <span>CSP Score {score}</span>
      <span className="text-[9px] font-normal text-neutral-400 pl-2 border-l border-neutral-600">{open ? 'Hide' : 'Details'}</span>
    </button>
  );
}

interface PanelProps {
  score: CspScoreResult;
  display: CspScoreDisplayValues;
  band: ScoreBand;
  capNote?: string | null;
}

export function CspScoreBreakdownPanel({ score, display, band, capNote }: PanelProps) {
  const rows = buildCspScoreRows(score, display);
  if (rows.length === 0 || score.total == null) return null;
  return (
    <div
      data-testid="csp-score-panel"
      className="border-t border-neutral-800 px-4 py-3 text-xs"
      onClick={(e) => e.stopPropagation()}
    >
      <p className="text-[10px] uppercase tracking-wider text-neutral-400 mb-2">How the score is built</p>
      <div className="overflow-x-auto">
        <table className="w-full tabular-nums">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-neutral-500 text-left">
              <th className="py-1 pr-3 font-semibold">Component</th>
              <th className="py-1 pr-3 font-semibold">Value</th>
              <th className="py-1 pr-3 font-semibold text-right">Points</th>
              <th className="py-1 pr-3 font-semibold w-28"><span className="sr-only">Share of points earned</span></th>
              <th className="py-1 font-semibold">Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-neutral-800" data-testid={`csp-score-row-${r.key}`}>
                <td className="py-1 pr-3 text-neutral-200 whitespace-nowrap">{r.label}</td>
                <td className="py-1 pr-3 text-neutral-300 whitespace-nowrap">{r.valueText}</td>
                <td className="py-1 pr-3 text-right text-neutral-200 whitespace-nowrap">{r.points.toFixed(1)} / {r.maxPoints}</td>
                <td className="py-1 pr-3">
                  <div className="h-1.5 w-24 rounded-sm bg-neutral-800">
                    <div
                      className={`h-1.5 rounded-sm ${r.weak ? 'bg-orange-400' : 'bg-teal-400'}`}
                      style={{ width: `${Math.round(r.fraction * 100)}%` }}
                    />
                  </div>
                </td>
                <td className={`py-1 ${r.weak ? 'text-orange-300' : 'text-neutral-500'}`}>{r.note}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-neutral-700 font-bold text-neutral-100">
              <td className="py-1 pr-3">CSP Score</td>
              <td className="py-1 pr-3" />
              <td className="py-1 pr-3 text-right whitespace-nowrap">{score.total.toFixed(1)} / {cspScoreMaxPoints()}</td>
              <td className="py-1 pr-3" />
              <td className="py-1 font-normal text-neutral-400">{SCORE_BAND_LABEL[band]}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {capNote && <p className="mt-2 text-[10px] text-orange-300" data-testid="csp-score-cap-note">{capNote}</p>}
    </div>
  );
}
