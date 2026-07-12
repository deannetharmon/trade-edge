// features/portfolio/health/health-types.ts
//
// PI-0002: TE-0006A (Portfolio Health Scoring) was consolidated into
// lib/portfolio-intelligence/health/. This file is now a compatibility
// re-export so existing imports keep working unchanged -- it contains no
// logic of its own. New code should import directly from
// '@/lib/portfolio-intelligence'.

export type {
  PositionHealthFactor,
  PositionHealthGrade,
  PositionHealthInput,
  PositionHealthLegInput,
  PositionHealthScore,
  PositionHealthSeverity,
  PositionHealthStrategy,
} from '@/lib/portfolio-intelligence/health/types';
