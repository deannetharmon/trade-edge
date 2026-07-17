// features/portfolio/intelligence/PositionIntelligencePanel.tsx
//
// PI-0005: Position Intelligence -- explains a single position's canonical
// recommendation (why, evidence, concerns, what would change it, what's
// next, and the reasonable management alternatives). Computes nothing:
// `recommendation` and `objective` are the exact same values PI-0002 already
// attaches to every position (`pos.recommendation` / `pos.portfolioObjective`
// in app/portfolio/page.tsx); this component only renders them. When
// `objective` is null (the existing "hold" case -- a healthy position with
// nothing to act on never gets a canonical objective built for it),
// Why/Review-Triggers fall back to `recommendation`'s own fields and to the
// same "next portfolio evaluation" phrasing the portfolio-level WAIT
// objective already uses, rather than inventing new copy.

'use client';

import { useState, type ReactNode } from 'react';
import { THEMES, Theme } from '@/lib/theme';
import type {
  ManagementIntentResult,
  PortfolioObjective,
  PortfolioRecommendation,
  PortfolioRecommendationUrgency,
  RemainingOpportunityResult,
} from '@/lib/portfolio-intelligence';
import type { PositionLifecycleType } from '@/lib/portfolio/positionLifecycle';
import type { DecisionReview } from '@/lib/decision-review';
import { deriveManagementChoices } from './managementChoices';
import { deriveNextLifecycleEvent } from './nextLifecycleEvent';
import { DecisionReviewSection } from '../decisionReview/DecisionReviewSection';

// UX Polish sprint: Decision Scorecard and Decision Review are real,
// functioning features (PI-0006B/PI-0007A and PI-0008C respectively), but
// they read as clutter -- mostly-empty forms/diagnostics -- in the
// day-to-day expanded panel most traders look at. Hidden here at the
// render layer only: no logic, data, or persistence removed, so either can
// be flipped back on in one line once they get a proper treatment in this
// panel's new layout.
const SHOW_DECISION_SCORECARD = false;
const SHOW_DECISION_REVIEW = false;

const URGENCY_ACCENT: Record<PortfolioRecommendationUrgency, { border: string; bg: string; text: string; chip: string }> = {
  low: { border: 'border-slate-500/50', bg: 'bg-slate-500/5', text: 'text-slate-300', chip: 'border-slate-600/60 text-slate-300' },
  medium: { border: 'border-amber-500/50', bg: 'bg-amber-500/5', text: 'text-amber-300', chip: 'border-amber-600/60 text-amber-300' },
  high: { border: 'border-orange-500/50', bg: 'bg-orange-500/5', text: 'text-orange-300', chip: 'border-orange-600/60 text-orange-300' },
  critical: { border: 'border-red-500/50', bg: 'bg-red-500/5', text: 'text-red-300', chip: 'border-red-600/60 text-red-300' },
};

export interface PositionIntelligencePanelProps {
  recommendation: PortfolioRecommendation;
  objective: PortfolioObjective | null;
  lifecycleType: PositionLifecycleType;
  // PI-0008A: optional so existing callers/tests that predate the Remaining
  // Opportunity Engine keep rendering unchanged -- the section below simply
  // doesn't render when this is absent.
  remainingOpportunity?: RemainingOpportunityResult | null;
  // PI-0008C: Decision Outcome Tracking. `strategy` is separate from
  // `recommendation` (which has no strategy field); `decisionReview` is the
  // existing review for this position if one has been saved, or
  // null/undefined otherwise. The section only renders when `onSaveDecisionReview`
  // is provided, so existing callers/tests that predate this ticket keep
  // rendering unchanged.
  strategy?: string;
  decisionReview?: DecisionReview | null;
  onSaveDecisionReview?: (review: DecisionReview) => void;
  th: typeof THEMES[Theme];
}

function Section({ title, th, children }: { title: string; th: typeof THEMES[Theme]; children: ReactNode }) {
  return (
    <div>
      <h4 className={`text-[10px] uppercase tracking-widest ${th.textFaint} mb-1.5`}>{title}</h4>
      {children}
    </div>
  );
}

// PI-0007A: collapsed-by-default developer/debug section exposing the
// canonical intent selector's full working -- every relevant candidate, its
// total score, and every recorded score contribution (captured at the exact
// `bump()` call site in managementIntent.ts, not reconstructed here), plus
// the winner/runner-up/margin/confidence-tier summary. Purely diagnostic:
// this component computes nothing and cannot influence which intent won --
// it only renders `recommendation.managementIntent`, the same object the
// position-objective evaluator already attached in PI-0006B. Renders
// nothing when `managementIntent` is absent (e.g. older fixtures/tests that
// predate PI-0006B/PI-0007A), same fallback posture as the rest of this
// panel.
function DecisionScorecard({ managementIntent, th }: { managementIntent: ManagementIntentResult; th: typeof THEMES[Theme] }) {
  const [expanded, setExpanded] = useState(false);
  const panelId = 'decision-scorecard-panel';
  const buttonId = 'decision-scorecard-toggle';

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
        <span className={`text-[10px] uppercase tracking-widest ${th.textFaint}`}>Decision Scorecard</span>
        <span
          className={`text-xs ${th.textFaint} transition-transform motion-safe:duration-150 ${expanded ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          &#9660;
        </span>
      </button>

      <div id={panelId} role="region" aria-labelledby={buttonId} hidden={!expanded} className="mt-2">
        {expanded && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
              <span className={th.textMuted}>
                <span className="font-semibold">Winner:</span> {managementIntent.label}
              </span>
              <span className={th.textMuted}>
                <span className="font-semibold">Confidence:</span> {managementIntent.confidenceTier}
              </span>
              <span className={th.textMuted}>
                <span className="font-semibold">Margin:</span> {managementIntent.margin}
              </span>
            </div>

            <ul className="space-y-1.5">
              {managementIntent.candidates.map((candidate) => (
                <li key={candidate.intent} className={`rounded border px-2 py-1.5 ${th.border}`}>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className={`font-semibold ${th.text}`}>
                      {candidate.label}
                      {candidate.isWinner ? ' (winner)' : ''}
                    </span>
                    <span className={`font-mono text-[10px] ${th.textFaint}`}>{candidate.score}</span>
                  </div>
                  {candidate.contributions.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {candidate.contributions.map((contribution) => (
                        <li key={contribution.id} className={`text-[10px] ${th.textFaint}`}>
                          <span className="font-mono">{contribution.points >= 0 ? `+${contribution.points}` : contribution.points}</span>
                          {' '}
                          {contribution.label}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// Elevates the recommendation from a bare bold label (the old "Current
// Recommendation" section) into the panel's visual entry point: the
// decision itself, the confidence behind it, the concrete suggested
// action, and a couple of the strongest supporting metrics -- so a trader
// can act from this card alone and only read further for detail. Renders
// nothing new: every field here already existed on `recommendation`
// (PI-0002/PI-0006B) or `whyEvidence` (derived below from the same
// objective/recommendation data the rest of the panel already used).
function SuggestedActionCard({
  recommendation,
  topEvidence,
  remainingOpportunity,
  th,
}: {
  recommendation: PortfolioRecommendation;
  topEvidence: { id: string; label: string }[];
  remainingOpportunity?: RemainingOpportunityResult | null;
  th: typeof THEMES[Theme];
}) {
  const accent = URGENCY_ACCENT[recommendation.urgency];
  const confidenceTier = recommendation.managementIntent?.confidenceTier;

  return (
    <div className={`rounded-lg border ${accent.border} ${accent.bg} px-4 py-3.5`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={`text-[9px] uppercase tracking-widest ${th.textFaint} mb-1`}>Suggested Action</p>
          <p className={`text-base font-bold leading-tight ${accent.text}`}>{recommendation.label}</p>
          <p className={`text-[12px] ${th.textMuted} mt-1`}>{recommendation.suggestedAction}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-[10px] px-2 py-0.5 border rounded font-bold uppercase tracking-wide ${accent.chip}`}>
            {recommendation.urgency}
          </span>
          <span className={`text-[11px] font-semibold ${th.text}`}>
            {recommendation.confidence}% confidence
            {confidenceTier ? <span className={`font-normal ${th.textFaint}`}> ({confidenceTier})</span> : null}
          </span>
        </div>
      </div>

      {(topEvidence.length > 0 || (remainingOpportunity && remainingOpportunity.remainingOpportunityPct != null)) && (
        <div className="flex flex-wrap items-center gap-1.5 mt-3">
          {remainingOpportunity && remainingOpportunity.remainingOpportunityPct != null && (
            <span className={`text-[10px] px-2 py-0.5 border rounded ${th.borderLight} ${th.textMuted}`}>
              {remainingOpportunity.remainingOpportunityPct}% opportunity remaining
            </span>
          )}
          {topEvidence.slice(0, 3).map((e) => (
            <span key={e.id} className={`text-[10px] px-2 py-0.5 border rounded ${th.borderLight} ${th.textMuted}`}>
              {e.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function PositionIntelligencePanel({ recommendation, objective, lifecycleType, remainingOpportunity, strategy, decisionReview, onSaveDecisionReview, th }: PositionIntelligencePanelProps) {
  const choices = deriveManagementChoices(recommendation.kind);
  const nextEvent = deriveNextLifecycleEvent(lifecycleType, recommendation.kind);

  const whyLead = objective ? objective.rationale : recommendation.primaryReason;
  const whyEvidence = objective
    ? objective.supportingEvidence.map((e) => ({ id: e.id, label: e.label, detail: e.explanation ?? String(e.value ?? '') }))
    : recommendation.supportingReasons.map((reason, i) => ({ id: `legacy-${i}`, label: reason.split(':')[0] ?? 'Factor', detail: reason }));

  const concerns = objective?.concerns ?? [];
  const reviewTriggers = objective?.reviewTriggers ?? [
    {
      id: 'next-evaluation',
      label: 'Next portfolio evaluation',
      explanation: 'Re-evaluate on the next scheduled portfolio review or when this position\'s data changes.',
    },
  ];

  return (
    <div className={`border-t ${th.border} px-4 py-4 space-y-5`} aria-label="Position Intelligence">
      <SuggestedActionCard
        recommendation={recommendation}
        topEvidence={whyEvidence}
        remainingOpportunity={remainingOpportunity}
        th={th}
      />

      {/* Two-column on wide viewports: left is the narrative (why this call,
          what's concerning); right is reference/next-step material (upside
          left on the table, what would flip the call, what happens next,
          the alternatives). Stacks to one column below `lg`. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-5">
        <div className="space-y-5">
          <Section title="Why" th={th}>
            <p className={`text-[11px] ${th.textMuted} mb-1.5`}>{whyLead}</p>
            {whyEvidence.length > 0 && (
              <ul className="space-y-1">
                {whyEvidence.map((e) => (
                  <li key={e.id} className="text-[11px]">
                    <span className={`font-semibold ${th.textMuted}`}>{e.label}</span>
                    {e.detail && <span className={th.textFaint}> &mdash; {e.detail}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Current Concerns" th={th}>
            {concerns.length > 0 ? (
              <ul className="space-y-1.5">
                {concerns.map((c) => (
                  <li key={c.id} className={`rounded border px-2 py-1.5 text-[11px] ${th.border}`}>
                    <span className="font-semibold">{c.label}</span>
                    <span className="opacity-80"> &mdash; {c.explanation}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={`text-[11px] ${th.textFaint}`}>No current concerns.</p>
            )}
          </Section>
        </div>

        <div className="space-y-5">
          {/* PI-0008A: Remaining Opportunity Engine -- a parallel, independent
              metric from the recommendation above (see remainingOpportunity.ts's
              module doc). Renders nothing when null (e.g. no credit basis to
              measure against) or absent (older callers/tests). Summary already
              surfaced on the Suggested Action card above; this is the detail view. */}
          {remainingOpportunity && remainingOpportunity.remainingOpportunityPct != null && (
            <Section title="Remaining Opportunity" th={th}>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                <span className={`text-[13px] font-bold ${th.text}`}>
                  {remainingOpportunity.remainingOpportunityPct}% remaining
                </span>
                <span className={`text-[11px] ${th.textMuted}`}>
                  {remainingOpportunity.opportunityCapturedPct}% captured
                </span>
              </div>
              {remainingOpportunity.reasons.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {remainingOpportunity.reasons.map((reason, i) => (
                    <li key={i} className={`text-[10px] ${th.textFaint}`}>{reason}</li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          <Section title="What Would Change This Recommendation?" th={th}>
            <ul className="space-y-1">
              {reviewTriggers.map((t) => (
                <li key={t.id} className={`text-[11px] ${th.textMuted}`}>
                  <span className="font-semibold">{t.label}</span>
                  {'threshold' in t && t.threshold !== undefined && <span className={th.textFaint}> ({String(t.threshold)})</span>}
                  <span className={th.textFaint}> &mdash; {t.explanation}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Next Expected Lifecycle Event" th={th}>
            <p className={`text-[11px] ${th.textMuted}`}>{nextEvent}</p>
          </Section>

          <Section title="Available Management Choices" th={th}>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`text-[10px] px-2 py-0.5 border rounded font-bold border-emerald-600/60 bg-emerald-500/10 text-emerald-400`}>
                {choices.preferred} (preferred)
              </span>
              {choices.alternatives.map((alt) => (
                <span key={alt} className={`text-[10px] px-2 py-0.5 border rounded ${th.border} ${th.textFaint}`}>
                  {alt}
                </span>
              ))}
            </div>
          </Section>
        </div>
      </div>

      {SHOW_DECISION_SCORECARD && recommendation.managementIntent && (
        <DecisionScorecard managementIntent={recommendation.managementIntent} th={th} />
      )}

      {/* PI-0008C: Decision Outcome Tracking -- records what happened, never
          influences the recommendation above. Hidden for now (UX polish
          sprint, see SHOW_DECISION_REVIEW above); logic/persistence untouched. */}
      {SHOW_DECISION_REVIEW && onSaveDecisionReview && (
        <DecisionReviewSection
          positionId={recommendation.positionId}
          symbol={recommendation.symbol}
          strategy={strategy ?? ''}
          recommendation={recommendation}
          review={decisionReview ?? null}
          onSave={onSaveDecisionReview}
          th={th}
        />
      )}
    </div>
  );
}
