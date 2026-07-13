// features/portfolio/briefing/suggestedFocus.ts
//
// PI-0004D: Suggested Focus -- the Daily Portfolio Briefing's single closing
// recommendation. Deliberately not a new recommendation: it repackages the
// top-ranked objective's own subject/summary (Portfolio Intelligence already
// decided this is the most important thing today via
// prioritizePortfolioObjectives). No commentary is generated here.

import type { PortfolioObjective } from '@/lib/portfolio-intelligence';

const NO_ACTION = 'No action required today.';

export function deriveSuggestedFocus(objectives: PortfolioObjective[] | null): string {
  if (!objectives || objectives.length === 0) return NO_ACTION;

  const top = objectives[0];
  if (top.type === 'WAIT') return NO_ACTION;

  const subjectLabel = top.subject.symbol ?? top.subject.label;
  return `${subjectLabel}: ${top.summary}`;
}
