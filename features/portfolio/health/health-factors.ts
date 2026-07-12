// features/portfolio/health/health-factors.ts
//
// PI-0002: TE-0006A consolidated into lib/portfolio-intelligence/health/.
// Compatibility re-export only -- no logic here. Had no external consumers
// at the time of consolidation.

export { clampScore, daysBetween, factor, isDateOnOrBeforeExpiration, normalizePercent } from '@/lib/portfolio-intelligence/health/factors';
