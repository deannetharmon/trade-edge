// features/portfolio/components/PositionHealthBadge.tsx
'use client';

import type { PositionHealthScore } from '../health/health-types';

const gradeClass: Record<PositionHealthScore['grade'], string> = {
  excellent: 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300',
  good: 'border-blue-500/60 bg-blue-500/10 text-blue-300',
  watch: 'border-amber-500/60 bg-amber-500/10 text-amber-300',
  action: 'border-orange-500/60 bg-orange-500/10 text-orange-300',
  critical: 'border-red-500/60 bg-red-500/10 text-red-300',
};

export function PositionHealthBadge({ health }: { health: PositionHealthScore | null | undefined }) {
  if (!health) return null;

  const topFactor = health.factors.find(f => f.severity !== 'neutral') ?? health.factors[0];

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[9px] font-semibold tracking-wide ${gradeClass[health.grade]}`}
      title={topFactor ? `${health.summary} ${topFactor.label}: ${topFactor.message}` : health.summary}
    >
      <span>HEALTH</span>
      <span>{health.score}</span>
    </div>
  );
}
