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

import type { ReactNode } from 'react';
import { THEMES, Theme } from '@/lib/theme';
import type { PortfolioObjective, PortfolioRecommendation } from '@/lib/portfolio-intelligence';
import type { PositionLifecycleType } from '@/lib/portfolio/positionLifecycle';
import { deriveManagementChoices } from './managementChoices';
import { deriveNextLifecycleEvent } from './nextLifecycleEvent';

export interface PositionIntelligencePanelProps {
  recommendation: PortfolioRecommendation;
  objective: PortfolioObjective | null;
  lifecycleType: PositionLifecycleType;
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

export function PositionIntelligencePanel({ recommendation, objective, lifecycleType, th }: PositionIntelligencePanelProps) {
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
    </div>
  );
}
