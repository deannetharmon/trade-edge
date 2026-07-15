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
import type { ManagementIntentResult, PortfolioObjective, PortfolioRecommendation, RemainingOpportunityResult } from '@/lib/portfolio-intelligence';
import type { PositionLifecycleType } from '@/lib/portfolio/positionLifecycle';
import { deriveManagementChoices } from './managementChoices';
import { deriveNextLifecycleEvent } from './nextLifecycleEvent';

export interface PositionIntelligencePanelProps {
  recommendation: PortfolioRecommendation;
  objective: PortfolioObjective | null;
  lifecycleType: PositionLifecycleType;
  // PI-0008A: optional so existing callers/tests that predate the Remaining
  // Opportunity Engine keep rendering unchanged -- the section below simply
  // doesn't render when this is absent.
  remainingOpportunity?: RemainingOpportunityResult | null;
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

export function PositionIntelligencePanel({ recommendation, objective, lifecycleType, remainingOpportunity, th }: PositionIntelligencePanelProps) {
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
    <div className={`border-t ${th.border} px-4 py-4 space-y-4`} aria-label="Position Intelligence">
      <Section title="Current Recommendation" th={th}>
        <p className={`text-[13px] font-bold ${th.text}`}>{recommendation.label}</p>
      </Section>

      {/* PI-0008A: Remaining Opportunity Engine -- a parallel, independent
          metric from the recommendation above (see remainingOpportunity.ts's
          module doc). Renders nothing when null (e.g. no credit basis to
          measure against) or absent (older callers/tests). */}
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

      {recommendation.managementIntent && (
        <DecisionScorecard managementIntent={recommendation.managementIntent} th={th} />
      )}
    </div>
  );
}
