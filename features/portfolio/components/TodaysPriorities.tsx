// features/portfolio/components/TodaysPriorities.tsx
//
// PI-0004A: renders the canonical Portfolio Intelligence priority list.
// This component computes nothing -- every value shown (title, priority,
// urgency, rule ID, evidence, concerns, review triggers, impacts) already
// exists on the PortfolioObjective the Portfolio page passes in. No
// ranking, scoring, severity, or confidence is derived here; ordering is
// rendered exactly as received (Portfolio Intelligence owns ordering).
//
// Field mapping (collapsed -> expanded), using only existing
// PortfolioObjective fields, nothing fabricated:
//   Priority title      -> objective.title
//   Recommendation badge -> objective.type (formatted to a readable label)
//   Priority tier        -> objective.priority
//   Urgency               -> objective.urgency
//   Stable Rule ID         -> objective.ruleId
//   Short explanation       -> objective.summary
//   [expanded] Recommendation -> objective.rationale (the full existing text)
//   [expanded] Evidence         -> objective.supportingEvidence
//   [expanded] Concerns           -> objective.concerns
//   [expanded] Review Trigger       -> objective.reviewTriggers
//   [expanded] Expected Outcome      -> objective.portfolioImpact /
//                                       incomeImpact / riskImpact /
//                                       capitalImpact (the four existing
//                                       impact dimensions collectively ARE
//                                       "what happens" -- there is no
//                                       separate expectedOutcome field to
//                                       invent one for)

'use client';

import { useCallback, useState, memo } from 'react';
import { THEMES, Theme } from '@/lib/theme';
import type {
  ObjectiveImpact,
  PortfolioObjective,
  PortfolioObjectivePriority,
  PortfolioObjectiveType,
  PortfolioObjectiveUrgency,
} from '@/lib/portfolio-intelligence';

const PRIORITY_STYLE: Record<PortfolioObjectivePriority, { border: string; bg: string; text: string; dot: string }> = {
  critical: { border: 'border-red-500/60', bg: 'bg-red-500/10', text: 'text-red-300', dot: 'bg-red-400' },
  high: { border: 'border-orange-500/60', bg: 'bg-orange-500/10', text: 'text-orange-300', dot: 'bg-orange-400' },
  medium: { border: 'border-amber-500/60', bg: 'bg-amber-500/10', text: 'text-amber-300', dot: 'bg-amber-400' },
  low: { border: 'border-slate-500/60', bg: 'bg-slate-500/10', text: 'text-slate-300', dot: 'bg-slate-400' },
  informational: { border: 'border-sky-500/50', bg: 'bg-sky-500/10', text: 'text-sky-300', dot: 'bg-sky-400' },
};

const URGENCY_LABEL: Record<PortfolioObjectiveUrgency, string> = {
  now: 'Now',
  today: 'Today',
  this_week: 'This Week',
  monitor: 'Monitor',
  none: '\u2014',
};

const TYPE_LABEL: Record<PortfolioObjectiveType, string> = {
  MANAGE_POSITION: 'Manage Position',
  CLOSE_FOR_PROFIT: 'Close For Profit',
  REVIEW_THREATENED_POSITION: 'Review Threatened Position',
  ROLL_POSITION: 'Roll Position',
  DEPLOY_IDLE_CASH: 'Deploy Idle Cash',
  INCREASE_INCOME: 'Increase Income',
  REDUCE_CONCENTRATION: 'Reduce Concentration',
  PRESERVE_BUYING_POWER: 'Preserve Buying Power',
  REVIEW_PENDING_ORDER: 'Review Pending Order',
  WAIT: 'Wait',
};

const IMPACT_DIRECTION_COLOR: Record<ObjectiveImpact['direction'], string> = {
  positive: 'text-emerald-400',
  negative: 'text-red-400',
  neutral: 'text-slate-400',
};

const EVIDENCE_TONE_COLOR: Record<string, string> = {
  positive: 'text-emerald-400',
  negative: 'text-red-400',
  warning: 'text-amber-400',
  neutral: 'text-slate-400',
};

const CONCERN_SEVERITY_STYLE: Record<string, string> = {
  critical: 'border-red-500/50 text-red-300',
  high: 'border-orange-500/50 text-orange-300',
  medium: 'border-amber-500/50 text-amber-300',
  low: 'border-slate-500/50 text-slate-300',
};

function ImpactRow({ label, impact, th }: { label: string; impact: ObjectiveImpact; th: typeof THEMES[Theme] }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className={`w-24 shrink-0 text-[10px] uppercase tracking-widest ${th.textFaint}`}>{label}</span>
      <div className="min-w-0 flex-1">
        <span className={`text-[11px] font-semibold ${IMPACT_DIRECTION_COLOR[impact.direction]}`}>
          {impact.direction === 'positive' ? '\u2191' : impact.direction === 'negative' ? '\u2193' : '\u2192'} {impact.magnitude}
        </span>
        <p className={`text-[11px] ${th.textMuted} mt-0.5`}>{impact.explanation}</p>
      </div>
    </div>
  );
}

const PriorityCard = memo(function PriorityCard({
  objective,
  expanded,
  onToggle,
  th,
}: {
  objective: PortfolioObjective;
  expanded: boolean;
  onToggle: (id: string) => void;
  th: typeof THEMES[Theme];
}) {
  const style = PRIORITY_STYLE[objective.priority];
  const panelId = `priority-panel-${objective.id}`;
  const buttonId = `priority-toggle-${objective.id}`;

  return (
    <div className={`rounded-xl border ${th.border} ${th.card} overflow-hidden`}>
      <button
        type="button"
        id={buttonId}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => onToggle(objective.id)}
        className={`flex w-full items-start gap-3 p-4 text-left transition-colors motion-safe:duration-150 hover:${th.cardQualified}`}
      >
        <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={`text-[13px] font-bold ${th.text}`}>{objective.title}</h3>
            <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${style.border} ${style.bg} ${style.text}`}>
              {TYPE_LABEL[objective.type]}
            </span>
          </div>

          <p className={`mt-1 text-[11px] ${th.textMuted}`}>{objective.summary}</p>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className={`text-[9px] uppercase tracking-widest ${style.text} font-bold`}>{objective.priority}</span>
            <span className={`text-[9px] uppercase tracking-widest ${th.textFaint}`}>{URGENCY_LABEL[objective.urgency]}</span>
            <span className={`font-mono text-[9px] ${th.textFaint}`}>{objective.ruleId}</span>
          </div>
        </div>

        <span
          className={`mt-1 shrink-0 text-xs ${th.textFaint} transition-transform motion-safe:duration-150 ${expanded ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          &#9660;
        </span>
      </button>

      <div
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        hidden={!expanded}
        className={`border-t ${th.borderLight} px-4 pb-4 pt-3`}
      >
        {expanded && (
          <div className="space-y-4">
            <div>
              <h4 className={`text-[10px] uppercase tracking-widest ${th.textFaint} mb-1`}>Recommendation</h4>
              <p className={`text-[12px] ${th.textMuted}`}>{objective.rationale}</p>
            </div>

            {objective.supportingEvidence.length > 0 && (
              <div>
                <h4 className={`text-[10px] uppercase tracking-widest ${th.textFaint} mb-1.5`}>Evidence</h4>
                <ul className="space-y-1">
                  {objective.supportingEvidence.map((e) => (
                    <li key={e.id} className="flex items-baseline gap-2 text-[11px]">
                      <span className={`font-semibold ${EVIDENCE_TONE_COLOR[e.tone] ?? th.textMuted}`}>{e.label}</span>
                      {e.value !== undefined && <span className={th.textMuted}>{String(e.value)}</span>}
                      {e.explanation && <span className={th.textFaint}>&mdash; {e.explanation}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {objective.concerns.length > 0 && (
              <div>
                <h4 className={`text-[10px] uppercase tracking-widest ${th.textFaint} mb-1.5`}>Concerns</h4>
                <ul className="space-y-1.5">
                  {objective.concerns.map((c) => (
                    <li key={c.id} className={`rounded border px-2 py-1.5 text-[11px] ${CONCERN_SEVERITY_STYLE[c.severity] ?? th.border}`}>
                      <span className="font-semibold">{c.label}</span>
                      <span className="opacity-80"> &mdash; {c.explanation}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {objective.reviewTriggers.length > 0 && (
              <div>
                <h4 className={`text-[10px] uppercase tracking-widest ${th.textFaint} mb-1.5`}>Review Trigger</h4>
                <ul className="space-y-1">
                  {objective.reviewTriggers.map((t) => (
                    <li key={t.id} className={`text-[11px] ${th.textMuted}`}>
                      <span className="font-semibold">{t.label}</span>
                      {t.threshold !== undefined && <span className={th.textFaint}> ({String(t.threshold)})</span>}
                      <span className={th.textFaint}> &mdash; {t.explanation}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <h4 className={`text-[10px] uppercase tracking-widest ${th.textFaint} mb-1`}>Expected Outcome</h4>
              <div className={`divide-y ${th.borderLight}`}>
                <ImpactRow label="Portfolio" impact={objective.portfolioImpact} th={th} />
                <ImpactRow label="Income" impact={objective.incomeImpact} th={th} />
                <ImpactRow label="Risk" impact={objective.riskImpact} th={th} />
                <ImpactRow label="Capital" impact={objective.capitalImpact} th={th} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

export interface TodaysPrioritiesProps {
  // null: Portfolio Intelligence has not computed anything yet (e.g. no
  // positions/orders loaded, or still loading). A non-null, non-empty array
  // always includes at least a WAIT objective (Portfolio Intelligence's own
  // "nothing to do" signal) -- this component never fabricates an empty
  // state, it renders whichever objective Portfolio Intelligence actually
  // returned.
  objectives: PortfolioObjective[] | null;
  loading: boolean;
  th: typeof THEMES[Theme];
}

export function TodaysPriorities({ objectives, loading, th }: TodaysPrioritiesProps) {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());

  const handleToggle = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  if (objectives === null) {
    if (!loading) return null;
    return (
      <section className="mx-6 mt-4" aria-label="Today's Priorities">
        <h2 className={`text-[11px] font-bold uppercase tracking-widest ${th.textFaint} mb-3`}>Today&apos;s Priorities</h2>
        <div className={`rounded-xl border ${th.border} ${th.card} p-6 text-center`}>
          <p className={`text-[11px] ${th.textFaint}`}>Loading priorities&hellip;</p>
        </div>
      </section>
    );
  }

  const isWaitOnly = objectives.length === 1 && objectives[0].type === 'WAIT';

  return (
    <section className="mx-6 mt-4" aria-label="Today's Priorities">
      <div className="mb-3 flex items-center justify-between">
        <h2 className={`text-[11px] font-bold uppercase tracking-widest ${th.textFaint}`}>Today&apos;s Priorities</h2>
        {!isWaitOnly && <span className={`text-[9px] ${th.textFaint}`}>{objectives.length} item{objectives.length !== 1 ? 's' : ''}</span>}
      </div>

      {isWaitOnly ? (
        <div className={`rounded-xl border ${th.border} ${th.card} p-6 text-center`}>
          <p className={`text-[12px] font-semibold ${th.text}`}>{objectives[0].title}</p>
          <p className={`mt-1 text-[11px] ${th.textFaint}`}>{objectives[0].rationale}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {objectives.map((objective) => (
            <PriorityCard
              key={objective.id}
              objective={objective}
              expanded={expandedIds.has(objective.id)}
              onToggle={handleToggle}
              th={th}
            />
          ))}
        </div>
      )}
    </section>
  );
}
