// features/portfolio/health/health-rules.ts

import type { PositionHealthGrade, PositionHealthInput, PositionHealthStrategy } from './health-types';

export function inferHealthStrategy(position: PositionHealthInput): PositionHealthStrategy {
  const strategy = String(position.strategy ?? '').toUpperCase();

  if (strategy === 'BPS' || strategy === 'BCS' || strategy === 'IC' || strategy.includes('SPREAD')) return 'credit-spread';
  if (strategy === 'PUT' || strategy.includes('CSP') || strategy.includes('SHORT PUT')) return 'cash-secured-put';
  if (strategy.includes('COVERED')) return 'covered-call';
  if (strategy === 'CALL' || strategy.includes('SHORT CALL')) return 'short-call';
  if (!position.legs || position.legs.length === 0) return 'long-shares';
  return 'other';
}

export function healthGrade(score: number): PositionHealthGrade {
  if (score >= 90) return 'excellent';
  if (score >= 75) return 'good';
  if (score >= 60) return 'watch';
  if (score >= 40) return 'action';
  return 'critical';
}

export function healthSummary(grade: PositionHealthGrade): string {
  switch (grade) {
    case 'excellent': return 'Healthy — leave it alone unless your thesis changes.';
    case 'good': return 'Good shape — monitor, but no urgent action.';
    case 'watch': return 'Watch — one or more factors deserve attention.';
    case 'action': return 'Action likely needed — review close, roll, or protection choices.';
    case 'critical': return 'Critical — prioritize review before adding new risk.';
  }
}
