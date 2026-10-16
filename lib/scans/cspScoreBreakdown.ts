// lib/scans/cspScoreBreakdown.ts
//
// CSP-SCORE-REVIEW-0001 -- turns a CspScoreResult into display rows
// (points earned out of points possible) for the card's score panel. Read
// only: this module never changes how a score is calculated.

import { CSP_SCORE_CONFIG, CSP_SCORE_WEIGHTS, type CspScoreComponentKey, type CspScoreResult } from './cspScore';

export interface CspScoreDisplayValues {
  pop: number | null | undefined;
  otmPct: number | null | undefined;
  periodRocPct: number | null | undefined;
  annualizedRocPct: number | null | undefined;
  liquidityClass: string | null | undefined;
  openInterest: number | null | undefined;
  ivr: number | null | undefined;
}

export interface CspScoreRow {
  key: CspScoreComponentKey;
  label: string;
  valueText: string;
  points: number;
  maxPoints: number;
  /** Fraction of the row's points earned, 0-1. */
  fraction: number;
  /** True when the row earned less than 40% of its points. */
  weak: boolean;
  note: string;
}

const ORDER: CspScoreComponentKey[] = [
  'pop', 'otm', 'periodRoc', 'annualizedRoc', 'liquidityWidth', 'liquidityOi', 'technical', 'ivr', 'eventRisk',
];

const LABEL: Record<CspScoreComponentKey, string> = {
  pop: 'POP',
  otm: 'OTM %',
  periodRoc: 'Period ROC',
  annualizedRoc: 'Annualized ROC',
  liquidityWidth: 'Liquidity (bid/ask)',
  liquidityOi: 'Liquidity (OI)',
  technical: 'Technical fit',
  ivr: 'IV rank',
  eventRisk: 'Event risk',
};

function pct(v: number | null | undefined, digits = 1): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(digits)}%` : '—';
}

function liquidityText(v: string | null | undefined): string {
  if (!v) return '—';
  const s = v.toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function valueText(key: CspScoreComponentKey, sub: number | null, d: CspScoreDisplayValues): string {
  switch (key) {
    case 'pop': return pct(d.pop, 0);
    case 'otm': return pct(d.otmPct);
    case 'periodRoc': return pct(d.periodRocPct);
    case 'annualizedRoc': return pct(d.annualizedRocPct, 0);
    case 'liquidityWidth': return liquidityText(d.liquidityClass);
    case 'liquidityOi': return typeof d.openInterest === 'number' ? d.openInterest.toLocaleString('en-US') : '—';
    case 'technical': return sub == null ? '—' : String(Math.round(sub));
    case 'ivr': return pct(d.ivr);
    case 'eventRisk': return sub === 100 ? 'None found' : sub === 0 ? 'Earnings before expiry' : '—';
  }
}

function noteFor(key: CspScoreComponentKey, sub: number | null): string {
  if (sub == null) return '';
  switch (key) {
    case 'otm': return sub < 100 ? `Full marks need ${CSP_SCORE_CONFIG.otmCapPct}% OTM` : '';
    case 'periodRoc': return sub < 100 ? `Full marks need ${CSP_SCORE_CONFIG.periodRocCapPct}% return` : '';
    case 'annualizedRoc': return sub >= 100 ? `Capped at ${CSP_SCORE_CONFIG.annualizedRocCapPct}%` : '';
    case 'technical': return sub < 40 ? 'Weak or unclear trend' : '';
    case 'ivr': return sub >= 100 ? 'Inside the preferred band' : 'Outside the preferred band';
    case 'eventRisk': return sub === 0 ? 'Earnings inside the window' : '';
    case 'liquidityWidth': return sub < 100 ? 'Wider bid/ask than the strong tier' : '';
    default: return '';
  }
}

/** Rows for an AVAILABLE score; an UNAVAILABLE score returns no rows. */
export function buildCspScoreRows(result: CspScoreResult, display: CspScoreDisplayValues): CspScoreRow[] {
  if (result.scoreStatus !== 'AVAILABLE') return [];
  return ORDER.map((key) => {
    const sub = result.components[key];
    const maxPoints = CSP_SCORE_WEIGHTS[key];
    const points = sub == null ? 0 : (sub * maxPoints) / 100;
    const fraction = maxPoints > 0 ? points / maxPoints : 0;
    return {
      key,
      label: LABEL[key],
      valueText: valueText(key, sub, display),
      points,
      maxPoints,
      fraction,
      weak: fraction < 0.4,
      note: noteFor(key, sub),
    };
  });
}

/** Total points possible across every row (100 when every weight is present). */
export function cspScoreMaxPoints(): number {
  return ORDER.reduce((sum, k) => sum + CSP_SCORE_WEIGHTS[k], 0);
}
