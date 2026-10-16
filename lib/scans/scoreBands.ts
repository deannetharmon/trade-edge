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

// CSP-SCORE-REVIEW-0001B2 (Ian, Alan) -- a Strong (green) CSP score also needs
// a real return. After the csp-score-v3 reweight, far-OTM puts earning 1.4-2.1%
// per cycle (about 17-22% annualized) could reach green on cushion alone. Green
// requires at least this annualized return; below it the band reads Acceptable.
// The score number itself is never changed. 30% is the lowest return that still
// leaves every in-band green in the 2026-10-16 Rank export (they run 52-92%).
export const GREEN_MIN_ANNUALIZED_ROC_PCT = 30;

export interface CappedScoreBand {
  band: ScoreBand;
  /** True when the score alone earned green but the return was too low. */
  capped: boolean;
}

export function capScoreBandByReturn(
  band: ScoreBand,
  annualizedRocPct: number | null | undefined,
  minPct: number = GREEN_MIN_ANNUALIZED_ROC_PCT,
): CappedScoreBand {
  if (band !== 'green') return { band, capped: false };
  const ok = typeof annualizedRocPct === 'number' && Number.isFinite(annualizedRocPct) && annualizedRocPct >= minPct;
  return ok ? { band, capped: false } : { band: 'yellow', capped: true };
}

export function returnCapNote(minPct: number = GREEN_MIN_ANNUALIZED_ROC_PCT): string {
  return `Score reaches Strong, but annualized return is under ${minPct}%, so the band stays Acceptable.`;
}
