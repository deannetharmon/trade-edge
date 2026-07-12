// features/portfolio/health/health-score.ts
//
// PI-0002: TE-0006A consolidated into lib/portfolio-intelligence/health/.
// Compatibility re-export only -- no logic here. New code should import
// directly from '@/lib/portfolio-intelligence'.

export { calculatePositionHealthScore } from '@/lib/portfolio-intelligence/health/score';
