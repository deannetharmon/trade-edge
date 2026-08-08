// features/screener/components/BestOpportunitiesShortlist.tsx
//
// SCREENER-UX-0001 — "Best qualified opportunities," item 4 in the required
// hierarchy. Collapsed-by-default ranked shortlist (top 3) instead of fully
// expanded recommendation cards. Rows never come from anywhere but the
// `rows` prop, which the page builds from qualified-only results (Task 1's
// shouldGenerateRecommendationsForSession() boundary) — this component does
// not know how to reach a disqualified/rejected candidate.

import { useId } from 'react';
import type { BestOpportunityRow } from '../lib/bestOpportunityRows';
import { useDisclosureA11y } from '../lib/useDisclosureA11y';

export interface BestOpportunitiesShortlistProps {
  rows: BestOpportunityRow[];
  maxVisible?: number;
  borderClassName?: string;
  textFaintClassName?: string;
  textMutedClassName?: string;
}

const REQUIRED_EMPTY_STATE_TEXT =
  'No qualified opportunities for this scan. Review the disqualified candidates and their reasons below.';

function formatPct(v: number | null): string {
  return v == null ? '—' : `${v.toFixed(0)}%`;
}

function ShortlistRow({
  row,
  th,
}: {
  row: BestOpportunityRow;
  th: { border: string; textFaint: string; textMuted: string };
}) {
  const panelId = useId();
  const { open: expanded, toggle, buttonRef, liveMessage } = useDisclosureA11y(
    `${row.symbol} opportunity details expanded`,
    `${row.symbol} opportunity details collapsed`,
  );
  return (
    <div className={`border ${th.border} rounded-lg overflow-hidden`}>
      <div className="flex items-center gap-3 px-3 py-2 text-[10px]">
        <span className={`shrink-0 font-bold ${th.textFaint}`}>#{row.rank}</span>
        <span className="shrink-0 font-semibold w-14">{row.symbol}</span>
        <span className={`shrink-0 ${th.textFaint} w-10`}>{row.strategy}</span>
        <span className={`shrink-0 ${th.textFaint} w-16`}>{row.dte != null ? `${row.dte}d` : '—'}</span>
        <span className="shrink-0 w-24">{row.strikeSummary}</span>
        <span className="shrink-0 w-24">{row.creditDebitLabel}</span>
        <span className={`shrink-0 ${th.textFaint} w-14`}>POP {formatPct(row.pop)}</span>
        <span className={`shrink-0 ${th.textFaint} w-14`}>OTM {formatPct(row.otmPct)}</span>
        <span className={`shrink-0 ${th.textFaint} w-16`}>ROC {formatPct(row.rocPct)}</span>
        <span className={`shrink-0 ${th.textFaint} w-16`}>OI {row.relevantLegOi ?? '—'}</span>
        <span className={`shrink-0 font-bold w-16`}>Score {row.opportunityScore ?? '—'}</span>
        {row.decisionConfidence != null && (
          <span className={`shrink-0 ${th.textFaint}`}>Confidence {row.decisionConfidence.toFixed(0)}</span>
        )}
        <button
          ref={buttonRef}
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={toggle}
          className={`ml-auto shrink-0 text-[9px] px-2 py-1 border ${th.border} rounded ${th.textMuted} hover:border-slate-400`}
        >
          {expanded ? 'Hide details' : 'View details'}
        </button>
      </div>
      <span role="status" aria-live="polite" className="sr-only">{liveMessage}</span>
      {expanded && (
        <div id={panelId} className={`px-3 pb-3 space-y-1.5 border-t ${th.border}`}>
          <p className={`text-[10px] ${th.textMuted} leading-relaxed pt-2`}>{row.primaryReason}</p>
          {row.supportingFactors.length > 0 && (
            <ul className="space-y-0.5">
              {row.supportingFactors.map((f, i) => <li key={i} className={`text-[9px] ${th.textFaint}`}>+ {f}</li>)}
            </ul>
          )}
          {row.riskTradeoffs.length > 0 && (
            <ul className="space-y-0.5">
              {row.riskTradeoffs.map((f, i) => <li key={i} className="text-[9px] text-amber-400/90">~ {f}</li>)}
            </ul>
          )}
          {row.portfolioConflicts.length > 0 && (
            <ul className="space-y-0.5">
              {row.portfolioConflicts.map((f, i) => <li key={i} className="text-[9px] text-blue-400/90">⚠ {f}</li>)}
            </ul>
          )}
          {row.exposureDisclosures.length > 0 && (
            <ul className="space-y-0.5">
              {row.exposureDisclosures.map((f, i) => <li key={i} className={`text-[9px] ${th.textFaint}`}>ℹ {f}</li>)}
            </ul>
          )}
          {row.rejectionReasons.length > 0 && (
            <ul className="space-y-0.5">
              {row.rejectionReasons.map((f, i) => <li key={i} className="text-[9px] text-red-400/90">✕ {f}</li>)}
            </ul>
          )}
          {row.missingInformationDisclosures.length > 0 && (
            <ul className="space-y-0.5">
              {row.missingInformationDisclosures.map((f, i) => <li key={i} className={`text-[9px] ${th.textFaint} italic`}>? {f}</li>)}
            </ul>
          )}
          {row.whatWouldImprove.length > 0 && (
            <p className={`text-[9px] ${th.textFaint} italic`}>Would improve with: {row.whatWouldImprove.join(' ')}</p>
          )}
        </div>
      )}
    </div>
  );
}

export function BestOpportunitiesShortlist({
  rows,
  maxVisible = 3,
  borderClassName = 'border-slate-700',
  textFaintClassName = 'text-slate-500',
  textMutedClassName = 'text-slate-300',
}: BestOpportunitiesShortlistProps) {
  const th = { border: borderClassName, textFaint: textFaintClassName, textMuted: textMutedClassName };
  const visible = rows.slice(0, maxVisible);

  return (
    <section aria-label="Best qualified opportunities" data-testid="best-opportunities-shortlist" className="space-y-2">
      <h3 className={`text-[9px] tracking-widest uppercase font-bold ${th.textFaint}`}>Best Opportunities</h3>
      {visible.length === 0 ? (
        <div className={`border ${th.border} rounded-lg px-4 py-4 text-center`}>
          <p className={`text-[11px] ${th.textFaint}`}>{REQUIRED_EMPTY_STATE_TEXT}</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {/* CSP-WORKFLOW-0001 core-correction (BLOCKER-04) — keyed by
              row.resultKey (the canonical ScreenResult.candidateId for CSP,
              never re-derived), not row.candidateId (the recommendation
              pipeline's own internal AutopilotCandidate id). */}
          {visible.map(row => <ShortlistRow key={row.resultKey} row={row} th={th} />)}
        </div>
      )}
    </section>
  );
}

/** IDs of the rows currently rendered in the shortlist, so the full Qualified
 * section below can mark the same candidate "Top opportunity" instead of
 * rendering a second, simultaneously-expanded copy of it. */
export function pickTopOpportunityIds(rows: BestOpportunityRow[], maxVisible = 3): Set<string> {
  return new Set(rows.slice(0, maxVisible).map(r => r.candidateId));
}
