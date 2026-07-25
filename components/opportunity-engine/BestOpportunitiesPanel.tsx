// components/opportunity-engine/BestOpportunitiesPanel.tsx
//
// OE-0001: read-only "Best Opportunities" surface. Renders an
// already-ranked OpportunityRecommendation[] (produced by
// lib/opportunity-engine's rankOpportunityCandidates() from real
// DecisionAnalysis-backed candidates) -- this component never fetches,
// scores, or ranks anything itself. It is purely presentational.
//
// STATUS (corrected, WA-0005): this component IS mounted in production
// today -- on /screener (the canonical Opportunities workspace, WA-0005)
// and on Mission Control's compact summary link target. The prior
// "intentionally NOT mounted anywhere" comment above described OE-0001's
// original state and went stale once OE-0002A activated a real feed; do
// not rely on it. See docs/design/WA-0005-Opportunities-Workspace-CES.md
// section 5.3 for the corrected mount-status finding.
//
// The `blockerNotice` prop exists for a caller that needs to disclose a
// loading/error condition upstream of this panel (e.g. the recommendation
// fetch is in flight or failed) rather than implying completeness.
//
// WA-0005 additions (all additive, presentation-only, no ranking/scoring
// change): a required capital-limitation notice (§10.1) whenever at least
// one candidate has been evaluated; a Detailed inspection tier per
// candidate, expandable via aria-expanded, driven by an optional
// `candidateDetails` index keyed by decisionAnalysisId (§13); non-color-only
// staleness disclosure (§16).
//
// PO corrective round, Finding 4: the capital-limitation notice was
// previously gated solely by `recommendations.length > 0`, which meant it
// never rendered for CES §15's two successful-zero-recommendation states
// (state 2: analyses existed but none became recommendations; state 5: the
// evaluation service produced no analyses at all) -- both are still an
// "applicable post-scan Ranked Opportunities presentation" per Ruling 1, so
// the notice must appear there too. `showCapitalNotice` lets the caller
// force the notice on even when `recommendations` is empty (states 2/5);
// when omitted, the original `recommendations.length > 0` default is used
// unchanged for every other case. `emptyStateMessage` similarly lets the
// caller substitute states 2/5's distinct, CES §15-mandated copy for the
// generic "No ranked opportunities to display." text, without introducing
// a second empty-state renderer elsewhere on the page.
//
// PO corrective round, Finding 3: `partialEvaluation` discloses a genuine
// partial-evaluation result (some candidates from this scan were skipped by
// the adapter while others were successfully evaluated) using the already-
// existing, canonical `skipped` field the recommendations API route already
// returns (lib/autopilot/decision/screenerCandidateAdapter.ts's own skip
// list, untouched) -- never fabricated, never inferred from an elapsed-time
// or arbitrary heuristic.
//
// PO corrective round, Finding 6: `blockerNoticeIsError` selects `role="alert"`
// for a genuine evaluation failure (matching this codebase's own convention,
// e.g. components/mission-control/MissionControl.tsx's `state === 'error'`
// branch), instead of `role="status"`, which remains reserved for
// non-error transient disclosures (loading, staleness, capital-limitation,
// partial-evaluation) -- consistent with docs/design/
// WA-0005-Opportunities-Workspace-CES.md §19's role="status" convention,
// which itself only ever discusses non-error banners.

import { useState } from 'react';
import type { Theme, THEMES } from '@/lib/theme';
import type { OpportunityDisposition, OpportunityRecommendation } from '@/lib/opportunity-engine';
import type { OpportunityCandidateDetail } from '@/lib/command-center/opportunityCandidateDetails';

export interface BestOpportunitiesPanelPartialEvaluation {
  /** Count of candidates the adapter could not/would not convert (e.g. PMCC), per the canonical `skipped` list already returned by /api/autopilot/recommendations. */
  skippedCount: number;
  /** Total candidates submitted for evaluation this scan. */
  totalSubmitted: number;
}

export interface BestOpportunitiesPanelProps {
  recommendations: OpportunityRecommendation[];
  generatedAt?: string;
  th: (typeof THEMES)[Theme];
  blockerNotice?: string;
  /** Finding 6: true when `blockerNotice` discloses a genuine evaluation failure (role="alert"); false/omitted for non-error transient notices (role="status"). */
  blockerNoticeIsError?: boolean;
  /** WA-0005 §13: additive, presentation-only detail index keyed by decisionAnalysisId. */
  candidateDetails?: Record<string, OpportunityCandidateDetail>;
  /** WA-0005 §16: true when a newer completed scan has superseded this presentation. */
  stale?: boolean;
  /** Finding 4: force the capital-limitation notice on even when `recommendations` is empty (CES §15 states 2/5). Omit to keep the `recommendations.length > 0` default. */
  showCapitalNotice?: boolean;
  /** Finding 4: overrides the generic empty-state copy (used for CES §15 states 2/5's distinct, required wording). */
  emptyStateMessage?: string;
  /** Finding 3: discloses a genuine partial-evaluation result for this scan. Omit/undefined when no canonical evidence supports it -- never fabricated. */
  partialEvaluation?: BestOpportunitiesPanelPartialEvaluation;
}

const DISPOSITION_STYLE: Record<OpportunityDisposition, string> = {
  RECOMMENDED: 'text-emerald-400 border-emerald-700 bg-emerald-500/10',
  ACCEPTABLE_ALTERNATIVE: 'text-blue-400 border-blue-700 bg-blue-500/10',
  WATCH: 'text-amber-400 border-amber-700 bg-amber-500/10',
  REJECTED: 'text-red-400 border-red-700 bg-red-500/10',
};

const DISPOSITION_LABEL: Record<OpportunityDisposition, string> = {
  RECOMMENDED: 'Recommended',
  ACCEPTABLE_ALTERNATIVE: 'Acceptable Alternative',
  WATCH: 'Watch',
  REJECTED: 'Rejected',
};

// WA-0005 §10.1: exact, binding, frozen copy. Automated tests assert on
// this string. Do not reword or make dismissible.
export const CAPITAL_LIMITATION_NOTICE =
  'Available capital is not connected for this scan, so candidates cannot be classified as Recommended. The absence of a Recommended pick does not mean no worthwhile candidates exist — review Watch and Acceptable Alternative candidates below on their own merits.';

function formatValue(value: number | string | undefined | null, suffix = ''): string {
  if (value === undefined || value === null || (typeof value === 'number' && Number.isNaN(value))) {
    return 'Not available';
  }
  return typeof value === 'number' ? `${value}${suffix}` : `${value}${suffix}`;
}

function DetailRow({ label, value, th }: { label: string; value: string; th: (typeof THEMES)[Theme] }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={`text-[9px] ${th.textFaint}`}>{label}</span>
      <span className={`text-[10px] font-semibold ${th.text}`}>{value}</span>
    </div>
  );
}

function CandidateDetailTier({
  detail,
  th,
}: {
  detail: OpportunityCandidateDetail | undefined;
  th: (typeof THEMES)[Theme];
}) {
  // WA-0005 §13: when the detail index has no entry for this candidate,
  // every field renders "Not available" -- never a missing/omitted section.
  return (
    <div className={`mt-2 rounded-lg border ${th.border} p-2.5 space-y-2`}>
      <DetailRow label="Expiration" th={th} value={formatValue(detail?.expiration)} />
      <DetailRow label="DTE" th={th} value={formatValue(detail?.dte)} />
      <DetailRow label="Underlying Price" th={th} value={detail?.underlyingPrice != null ? `$${detail.underlyingPrice.toFixed(2)}` : 'Not available'} />
      <DetailRow label="Credit / Debit" th={th} value={detail?.credit != null ? `$${detail.credit.toFixed(2)}` : 'Not available'} />
      <DetailRow label="Capital Requirement" th={th} value={detail?.capitalRequirement != null ? `$${detail.capitalRequirement.toFixed(2)}` : 'Not available'} />
      <DetailRow label="ROC" th={th} value={detail?.roc != null ? `${detail.roc}%` : 'Not available'} />
      <DetailRow label="Annualized Yield" th={th} value={detail?.annualizedYield != null ? `${detail.annualizedYield}%` : 'Not available'} />
      <DetailRow label="Probability of Profit" th={th} value={detail?.pop != null ? `${detail.pop}%` : 'Not available'} />
      <DetailRow label="Beta-Weighted Delta" th={th} value={formatValue(detail?.betaWeightedDelta)} />
      <DetailRow label="Assignment Probability" th={th} value={detail?.assignmentProbabilityPct != null ? `${detail.assignmentProbabilityPct}%` : 'Not available'} />
      <DetailRow label="IV Rank" th={th} value={detail?.ivr != null ? `${detail.ivr}%` : 'Not available'} />
      <DetailRow label="Earnings Date" th={th} value={formatValue(detail?.earningsDate)} />

      {detail?.legs && detail.legs.length > 0 && (
        <div className="pt-1">
          <p className={`text-[9px] ${th.textFaint} mb-1`}>Strikes</p>
          <ul className="space-y-0.5">
            {detail.legs.map((leg, i) => (
              <li key={i} className={`text-[10px] ${th.textMuted}`}>
                {leg.direction} {leg.optionType ?? ''} {leg.strike ?? 'Not available'} exp {leg.expiration ?? 'Not available'}
              </li>
            ))}
          </ul>
        </div>
      )}

      {detail && detail.concerns.length > 0 && (
        <div className="pt-1">
          <p className={`text-[9px] ${th.textFaint} mb-1`}>Concerns</p>
          <ul className="space-y-0.5">
            {detail.concerns.map((concern) => (
              <li key={concern.id} className={`text-[10px] ${th.textMuted}`}>
                [{concern.severity}] {concern.label} — {concern.explanation}
              </li>
            ))}
          </ul>
        </div>
      )}

      {detail && detail.alternatives.length > 0 && (
        <div className="pt-1">
          <p className={`text-[9px] ${th.textFaint} mb-1`}>Alternatives Considered</p>
          <ul className="space-y-0.5">
            {detail.alternatives.map((alt, i) => (
              <li key={i} className={`text-[10px] ${th.textMuted}`}>
                {alt.action} ({alt.disposition}, score {alt.score})
              </li>
            ))}
          </ul>
        </div>
      )}

      {detail && detail.reviewTriggers.length > 0 && (
        <div className="pt-1">
          <p className={`text-[9px] ${th.textFaint} mb-1`}>Review Triggers</p>
          <ul className="space-y-0.5">
            {detail.reviewTriggers.map((trigger) => (
              <li key={trigger.id} className={`text-[10px] ${th.textMuted}`}>{trigger.label} — {trigger.explanation}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="pt-1">
        <p className={`text-[9px] ${th.textFaint} mb-1`}>Expected Outcome</p>
        <DetailRow label="Intent" th={th} value={formatValue(detail?.expectedOutcome?.intent)} />
        <DetailRow label="Expected Credit" th={th} value={detail?.expectedOutcome?.expectedCredit != null ? `$${detail.expectedOutcome.expectedCredit.toFixed(2)}` : 'Not available'} />
        <DetailRow label="Expected Annualized Return" th={th} value={detail?.expectedOutcome?.expectedAnnualizedReturnPct != null ? `${detail.expectedOutcome.expectedAnnualizedReturnPct}%` : 'Not available'} />
        <DetailRow label="Expected Holding Days" th={th} value={formatValue(detail?.expectedOutcome?.expectedHoldingDays)} />
      </div>

      <div className="pt-1">
        <p className={`text-[9px] ${th.textFaint} mb-1`}>Rules Evaluated / Blocked</p>
        <p className={`text-[10px] ${th.textMuted}`}>{detail && detail.rulesEvaluated.length > 0 ? detail.rulesEvaluated.join(', ') : 'Not available'}</p>
        <p className={`text-[10px] ${th.textMuted}`}>{detail && detail.rulesBlocked.length > 0 ? detail.rulesBlocked.join(', ') : 'Not available'}</p>
      </div>

      <p className={`text-[9px] ${th.textFaint} italic pt-1 border-t ${th.border}`}>
        This is analysis only, not an executable action — no order, trade, or paper-trade submission is available from this view.
      </p>
    </div>
  );
}

function RecommendationCard({
  rec,
  th,
  detail,
}: {
  rec: OpportunityRecommendation;
  th: (typeof THEMES)[Theme];
  detail: OpportunityCandidateDetail | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailPanelId = `opportunity-detail-${rec.candidateId}`;

  return (
    <div className={`border ${th.border} rounded-xl p-3 ${th.card} space-y-2`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${th.tag} ${th.textFaint}`}>#{rec.rank}</span>
          <span className={`text-sm font-semibold ${th.text}`}>{rec.symbol}</span>
          <span className={`text-[10px] ${th.textFaint}`}>{rec.strategy}</span>
          <span className={`text-[9px] ${th.textFaint} uppercase tracking-wide`}>{rec.source}</span>
        </div>
        <span className={`text-[9px] font-bold px-2 py-0.5 border rounded ${DISPOSITION_STYLE[rec.disposition]}`}>
          {DISPOSITION_LABEL[rec.disposition]}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <div>
          <p className={`text-[9px] ${th.textFaint}`}>Opportunity Score</p>
          <p className={`text-sm font-bold ${th.text}`}>{rec.opportunityScoreTotal ?? '—'}</p>
        </div>
        <div>
          <p className={`text-[9px] ${th.textFaint}`}>Decision Confidence</p>
          {/* WA-0005 §15/§21: confidence.overall is required/non-optional on
              DecisionConfidence, but a defensive null/undefined check is kept
              here (never coerced to 0, which would misleadingly read as
              "very low confidence") in case an upstream producer ever
              supplies an incomplete value. */}
          <p className={`text-sm font-bold ${th.text}`}>
            {rec.decisionConfidenceTotal === null || rec.decisionConfidenceTotal === undefined || Number.isNaN(rec.decisionConfidenceTotal)
              ? 'confidence unavailable'
              : rec.decisionConfidenceTotal.toFixed(0)}
          </p>
        </div>
      </div>

      <p className={`text-[11px] ${th.textMuted} leading-relaxed`}>{rec.primaryReason}</p>

      {rec.supportingFactors.length > 0 && (
        <ul className="space-y-0.5">
          {rec.supportingFactors.map((factor, i) => (
            <li key={i} className={`text-[10px] ${th.textFaint}`}>+ {factor}</li>
          ))}
        </ul>
      )}

      {rec.riskTradeoffs.length > 0 && (
        <ul className="space-y-0.5">
          {rec.riskTradeoffs.map((tradeoff, i) => (
            <li key={i} className={`text-[10px] text-amber-400/90`}>~ {tradeoff}</li>
          ))}
        </ul>
      )}

      {rec.portfolioConflicts.length > 0 && (
        <ul className="space-y-0.5">
          {rec.portfolioConflicts.map((conflict, i) => (
            <li key={i} className={`text-[10px] text-blue-400/90`}>⚠ {conflict}</li>
          ))}
        </ul>
      )}

      {/* Informational only -- ordinary nonzero ticker/sector exposure.
          Rendered distinctly (muted, not blue/warning-colored) from
          portfolioConflicts above, since these never affected this
          candidate's disposition. */}
      {rec.exposureDisclosures.length > 0 && (
        <ul className="space-y-0.5">
          {rec.exposureDisclosures.map((disclosure, i) => (
            <li key={i} className={`text-[10px] ${th.textFaint}`}>ℹ {disclosure}</li>
          ))}
        </ul>
      )}

      {rec.rejectionReasons.length > 0 && (
        <ul className="space-y-0.5">
          {rec.rejectionReasons.map((reason, i) => (
            <li key={i} className={`text-[10px] text-red-400/90`}>✕ {reason}</li>
          ))}
        </ul>
      )}

      {rec.missingInformationDisclosures.length > 0 && (
        <ul className="space-y-0.5">
          {rec.missingInformationDisclosures.map((disclosure, i) => (
            <li key={i} className={`text-[10px] ${th.textFaint} italic`}>? {disclosure}</li>
          ))}
        </ul>
      )}

      {rec.whatWouldImprove.length > 0 && (
        <p className={`text-[10px] ${th.textFaint} italic`}>
          Would improve with: {rec.whatWouldImprove.join(' ')}
        </p>
      )}

      {/* WA-0005 §13/§17/§19/§24: Detailed tier, inline aria-expanded
          expansion -- matches TodaysPrioritiesQueueView.tsx's existing
          collapse pattern. Not a modal/drawer: no focus trap, focus stays
          on the trigger after toggling. */}
      {/* Finding 6: no codified 44x44 CSS-pixel touch-target convention was
          found anywhere in this repository (features/portfolio/ and
          TodaysPrioritiesQueueView.tsx's own toggle both use padding-only
          sizing well under 44px) -- there is nothing pre-existing to
          "match." This establishes a minimal, standard WCAG 2.5.5/2.5.8-
          compliant target (min-h-[44px] min-w-[44px], inline-flex centered)
          for this sprint's one new interactive control, without changing
          its visual density (text stays the same small label; only the
          tappable box grows). */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={detailPanelId}
        className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-[9px] font-bold uppercase tracking-wide ${th.textFaint} hover:${th.text} focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-blue-500 rounded px-3 py-0.5`}
      >
        {expanded ? '▲ Hide Details' : '▼ Show Details'}
      </button>
      {expanded && (
        <div id={detailPanelId}>
          <CandidateDetailTier detail={detail} th={th} />
        </div>
      )}
    </div>
  );
}

export function BestOpportunitiesPanel({
  recommendations,
  generatedAt,
  th,
  blockerNotice,
  blockerNoticeIsError,
  candidateDetails,
  stale,
  showCapitalNotice,
  emptyStateMessage,
  partialEvaluation,
}: BestOpportunitiesPanelProps) {
  const capitalNoticeVisible = showCapitalNotice ?? recommendations.length > 0;

  return (
    <div className="space-y-3 max-w-5xl">
      <div className="flex items-center justify-between">
        <p className={`text-[9px] ${th.textFaint} tracking-widest uppercase font-bold`}>Best Opportunities</p>
        {generatedAt && (
          <p className={`text-[9px] ${th.textFaint}`}>as of {new Date(generatedAt).toLocaleString()}</p>
        )}
      </div>

      {/* WA-0005 §16/§19: non-color-only staleness disclosure -- icon + text,
          never a color change alone. role="status" matches the existing
          transient-banner convention. Results remain fully visible below,
          never hidden. */}
      {stale && (
        <div role="status" className="flex items-center gap-2 border border-amber-600/60 bg-amber-500/10 rounded-xl px-4 py-2">
          <span aria-hidden="true">⟳</span>
          <p className={`text-[10px] ${th.textFaint} leading-relaxed`}>
            Superseded by a newer scan — these results are stale but remain visible for reference.
          </p>
        </div>
      )}

      {/* Finding 3: partial-evaluation disclosure -- only rendered when the
          caller supplies real, canonical evidence (the API's own `skipped`
          list); never fabricated. Non-color-only (icon + text), distinct
          from blockerNotice/capital-notice/stale. Preserves and does not
          discard the candidates that WERE successfully evaluated below. */}
      {partialEvaluation && partialEvaluation.skippedCount > 0 && (
        <div role="status" className="flex items-start gap-2 border border-amber-600/60 bg-amber-500/10 rounded-xl px-4 py-3">
          <span aria-hidden="true">◐</span>
          <p className={`text-[10px] ${th.textFaint} leading-relaxed`}>
            Partial evaluation: {partialEvaluation.skippedCount} of {partialEvaluation.totalSubmitted} scan results could not be evaluated. The candidates below reflect what could be evaluated successfully.
          </p>
        </div>
      )}

      {blockerNotice && (
        <div
          role={blockerNoticeIsError ? 'alert' : 'status'}
          className={`border ${blockerNoticeIsError ? 'border-red-800 bg-red-500/5' : `${th.border} bg-amber-500/5`} rounded-xl px-4 py-3`}
        >
          <p className={`text-[10px] ${blockerNoticeIsError ? 'text-red-400' : th.textFaint} leading-relaxed`}>{blockerNotice}</p>
        </div>
      )}

      {/* WA-0005 §10.1 (corrected, Finding 4): required, persistent,
          non-dismissible capital-limitation notice -- a capability
          limitation, not an error/empty state. Renders whenever Ranked
          Opportunities is an applicable post-scan presentation, including
          when the caller forces it on via `showCapitalNotice` for CES §15's
          states 2/5 (recommendations.length === 0 but evaluation genuinely
          ran). Non-color-only (icon + text), visually distinct from
          blockerNotice (loading/error) and from the staleness indicator
          above. */}
      {capitalNoticeVisible && (
        <div role="status" className="flex items-start gap-2 border border-blue-700/60 bg-blue-500/10 rounded-xl px-4 py-3">
          <span aria-hidden="true">ℹ</span>
          <p className={`text-[10px] ${th.textFaint} leading-relaxed`}>{CAPITAL_LIMITATION_NOTICE}</p>
        </div>
      )}

      {recommendations.length === 0 ? (
        <div role="status" className={`border ${th.border} rounded-xl px-4 py-6 text-center`}>
          <p className={`text-[11px] ${th.textFaint}`}>{emptyStateMessage ?? 'No ranked opportunities to display.'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {recommendations.map((rec) => (
            <RecommendationCard
              key={rec.candidateId}
              rec={rec}
              th={th}
              detail={candidateDetails?.[rec.decisionAnalysisId]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
