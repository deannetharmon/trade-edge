// features/portfolio/health/health-rules.ts
//
// PI-0002: TE-0006A consolidated into lib/portfolio-intelligence/health/.
// Compatibility re-export only -- no logic here. Had no external consumers
// at the time of consolidation (only health-score.ts used it internally,
// which now points at the canonical module directly).

export { healthGrade, healthSummary, inferHealthStrategy } from '@/lib/portfolio-intelligence/health/rules';
