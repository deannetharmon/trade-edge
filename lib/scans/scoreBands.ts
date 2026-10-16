// lib/scans/scoreBands.ts
//
// CSP-SCORE-REVIEW-0001 -- one place that maps a 0-100 score to a quality
// band. The floors default to the existing Rank config floors (75/55/35,
// user-adjustable in the app); callers pass the live floors when they have
// them. Pure and framework-free.

export type ScoreBand = 'green' | 'yellow' | 'orange' | 'red';

export interface ScoreBandFloors {
  green: number;
  yellow: number;
  orange: number;
}

export const DEFAULT_SCORE_BAND_FLOORS: ScoreBandFloors = { green: 75, yellow: 55, orange: 35 };

export const SCORE_BAND_LABEL: Record<ScoreBand, string> = {
  green: 'Strong',
  yellow: 'Acceptable',
  orange: 'Marginal',
  red: 'Avoid',
};

export function scoreBand(score: number, floors: ScoreBandFloors = DEFAULT_SCORE_BAND_FLOORS): ScoreBand {
  if (score >= floors.green) return 'green';
  if (score >= floors.yellow) return 'yellow';
  if (score >= floors.orange) return 'orange';
  return 'red';
}
