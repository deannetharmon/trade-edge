// features/portfolio/positions/PositionRiskBadges.tsx
//
// WA-0002: Position-Specific Risk Badges.
//
// Surfaces two of PortfolioObjective's already-computed facts -- assignment
// exposure and earnings exposure -- directly on the position's own card, at
// a glance, instead of only inside the collapsed Position Intelligence panel
// (features/portfolio/intelligence/PositionIntelligencePanel.tsx).
//
// This component performs no lookup, no join, and no domain computation.
// `pos.portfolioObjective` is already attached to every position today
// (PI-0002); this component reads it directly via two predicates already
// used elsewhere in this codebase for the identical purpose --
// `ruleId === 'OBJ-ASSIGNMENT-RISK'` and an `'earnings'` review trigger (see
// lib/portfolio-intelligence/dashboardComposition.ts's own earnings-review
// predicate, `p.portfolioObjective?.reviewTriggers.some(t => t.triggerType
// === 'earnings')`). No new identifier, no new severity model, and no new
// copy -- `objective.title`/`objective.summary` are reused as-is.
//
// Deliberately narrow: concentration, capital, and generic immediate-
// attention risk are NOT position-specific (they're portfolio-wide, or a
// mixed bucket already fully covered by Mission Control's own Attention
// Required section) and are intentionally never rendered here -- see
// docs/design/WA-0002-Positions-Legacy-Mission-Control-CES.md, Section 8.

'use client';

import { THEMES, Theme } from '@/lib/theme';
import type { PortfolioObjective } from '@/lib/portfolio-intelligence';

export interface PositionRiskBadgesProps {
  // `null` for positions with no canonical objective (e.g. a healthy "hold"
  // position, which never gets one built for it) -- renders nothing.
  objective: PortfolioObjective | null;
  th: typeof THEMES[Theme];
}

interface RiskBadge {
  key: 'assignment_exposure' | 'earnings_exposure';
  label: string;
}

function isAssignmentExposure(objective: PortfolioObjective): boolean {
  return objective.ruleId === 'OBJ-ASSIGNMENT-RISK';
}

function isEarningsExposure(objective: PortfolioObjective): boolean {
  return objective.reviewTriggers.some((t) => t.triggerType === 'earnings');
}

export function PositionRiskBadges({ objective, th }: PositionRiskBadgesProps) {
  if (!objective) return null;

  const badges: RiskBadge[] = [];
  if (isAssignmentExposure(objective)) {
    badges.push({ key: 'assignment_exposure', label: 'Assignment Risk' });
  }
  if (isEarningsExposure(objective)) {
    badges.push({ key: 'earnings_exposure', label: 'Earnings Risk' });
  }

  if (badges.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 flex-wrap" aria-label="Position Risk" data-testid="position-risk-badges">
      {badges.map((badge) => (
        <span
          key={badge.key}
          title={objective.summary}
          className="text-[9px] px-2 py-0.5 border rounded-full font-bold whitespace-nowrap border-amber-600/60 text-amber-400 bg-amber-500/10"
        >
          &#9888; {badge.label}
        </span>
      ))}
    </div>
  );
}
