// components/opportunity-engine/BestOpportunitiesPanel.tsx
//
// OE-0001: read-only "Best Opportunities" surface. Renders an
// already-ranked OpportunityRecommendation[] (produced by
// lib/opportunity-engine's rankOpportunityCandidates() from real
// DecisionAnalysis-backed candidates) -- this component never fetches,
// scores, or ranks anything itself. It is purely presentational.
//
// STATUS: intentionally NOT mounted anywhere in production. Per Product
// Owner review, mounting an empty tab with no real candidate feed was
// rejected -- an unmounted component with no live consumer is preferable
// to a production surface with nothing behind it. This component is kept
// as a finished, tested, reusable building block: it is compatible with
// real DecisionAnalysis-backed OpportunityRecommendation[] output and
// ready to be mounted the moment a page owns a real, live
// DecisionAnalysis[] feed (see docs/design/OE-0001-Opportunity-Engine-Foundation.md
// section 7 for the exact architectural reason none exists yet, and
// docs/roadmap/ROADMAP.md for the deferred future-sprint item that would
// close that gap). Do not mount this component with mock data, a new
// fetch, persistence, or cross-page state -- only with a real,
// already-computed OpportunityRecommendation[].
//
// The `blockerNotice` prop exists for a future caller that mounts this
// panel before a full live feed is available (e.g. a page with a partial
// candidate source) and needs to disclose that honestly rather than
// implying completeness.

import type { Theme, THEMES } from '@/lib/theme';
import type { OpportunityDisposition, OpportunityRecommendation } from '@/lib/opportunity-engine';

export interface BestOpportunitiesPanelProps {
  recommendations: OpportunityRecommendation[];
  generatedAt?: string;
  th: (typeof THEMES)[Theme];
  blockerNotice?: string;
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

function RecommendationCard({
  rec,
  th,
}: {
  rec: OpportunityRecommendation;
  th: (typeof THEMES)[Theme];
}) {
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
          <p className={`text-sm font-bold ${th.text}`}>{rec.decisionConfidenceTotal.toFixed(0)}</p>
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
    </div>
  );
}

export function BestOpportunitiesPanel({ recommendations, generatedAt, th, blockerNotice }: BestOpportunitiesPanelProps) {
  return (
    <div className="space-y-3 max-w-5xl">
      <div className="flex items-center justify-between">
        <p className={`text-[9px] ${th.textFaint} tracking-widest uppercase font-bold`}>Best Opportunities</p>
        {generatedAt && (
          <p className={`text-[9px] ${th.textFaint}`}>as of {new Date(generatedAt).toLocaleString()}</p>
        )}
      </div>

      {blockerNotice && (
        <div className={`border ${th.border} rounded-xl px-4 py-3 bg-amber-500/5`}>
          <p className={`text-[10px] ${th.textFaint} leading-relaxed`}>{blockerNotice}</p>
        </div>
      )}

      {recommendations.length === 0 ? (
        <div className={`border ${th.border} rounded-xl px-4 py-6 text-center`}>
          <p className={`text-[11px] ${th.textFaint}`}>No ranked opportunities to display.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {recommendations.map((rec) => (
            <RecommendationCard key={rec.candidateId} rec={rec} th={th} />
          ))}
        </div>
      )}
    </div>
  );
}
