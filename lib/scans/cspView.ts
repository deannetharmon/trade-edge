// lib/scans/cspView.ts
//
// SCAN-SIMPLIFY-0001 -- the CSP scan only FETCHES (tickers + DTE range). Delta band, IVR
// band, open-interest preference, return and DTE window are a VIEW over the fetched
// contracts: changing them never triggers a scan. This module is pure. It re-grades a
// scan-time result against the active view without mutating it, so session accounting
// (computed from the untouched scan results) stays fixed.

import { DEFAULT_CSP_RULES, type CspRulesType } from './constants';
import { calculateCspScore, type CspScoreInputs } from './cspScore';
import { isMarketQualified, isOverallCspQualified } from './cspQualification';
import type { ScreenResult } from './types';

export type CspViewPresetKey = 'conservative' | 'balanced' | 'opportunity' | 'all' | 'custom';

/** The view-side grading controls. DTE is the scan's own range unless the user narrows it. */
export interface CspView {
  preset: CspViewPresetKey;
  deltaMin: number;
  deltaMax: number;
  ivrMin: number;
  ivrMax: number;
  oiMin: number;
  dteMin: number;
  dteMax: number;
  /** Return >= (period ROC %, 0 = any). */
  returnMin: number;
}

export interface CspViewPreset {
  key: Exclude<CspViewPresetKey, 'custom'>;
  label: string;
  description: string;
  deltaMin: number; deltaMax: number;
  ivrMin: number; ivrMax: number;
  oiMin: number;
}

// Same numbers as the former pre-scan presets. DTE is deliberately NOT part of a preset:
// the user already chose it in the scan modal and has its own results control.
export const CSP_VIEW_PRESETS: CspViewPreset[] = [
  { key: 'conservative', label: 'Conservative', description: 'Lower delta, less event risk, and deeper liquidity.', deltaMin: 0.10, deltaMax: 0.20, ivrMin: 30, ivrMax: 60, oiMin: 1000 }, // PRESETS-0001 (Ian)
  { key: 'balanced', label: 'Balanced', description: 'Default CSP discovery range.', deltaMin: 0.15, deltaMax: 0.25, ivrMin: 30, ivrMax: 70, oiMin: 500 },
  { key: 'opportunity', label: 'More opportunities', description: 'Wider delta and IVR.', deltaMin: 0.12, deltaMax: 0.30, ivrMin: 20, ivrMax: 75, oiMin: 250 },
  // PRESET-ALL-0001: everything the scan fetched; no delta, IVR or OI limits (liquidity/earnings/capital rules still apply).
  { key: 'all', label: 'All', description: 'Everything the scan fetched, no delta, IVR or OI limits.', deltaMin: 0, deltaMax: 1, ivrMin: 0, ivrMax: 100, oiMin: 0 },
];

export const DEFAULT_CSP_VIEW_PRESET: CspViewPresetKey = 'balanced';

/** Scan-time grading rules: wide open, so the view (not the scan) decides what is hidden. */
export const CSP_SCAN_WIDE_IVR_MAX = 100;

export function cspViewFromPreset(key: CspViewPresetKey, dteMin: number, dteMax: number): CspView {
  const p = CSP_VIEW_PRESETS.find((x) => x.key === key) ?? CSP_VIEW_PRESETS[1];
  return {
    preset: key === 'custom' ? 'custom' : p.key,
    deltaMin: p.deltaMin, deltaMax: p.deltaMax,
    ivrMin: p.ivrMin, ivrMax: p.ivrMax,
    oiMin: p.oiMin, dteMin, dteMax, returnMin: 0,
  };
}

/** Which preset (if any) the view's grading numbers still equal; otherwise 'custom'. */
export function detectCspPreset(v: Pick<CspView, 'deltaMin' | 'deltaMax' | 'ivrMin' | 'ivrMax' | 'oiMin'>): CspViewPresetKey {
  const hit = CSP_VIEW_PRESETS.find((p) =>
    p.deltaMin === v.deltaMin && p.deltaMax === v.deltaMax && p.ivrMin === v.ivrMin && p.ivrMax === v.ivrMax && p.oiMin === v.oiMin);
  return hit ? hit.key : 'custom';
}

/** The rules the scan grades with: the balanced values, with the IVR cap lifted. */
export function cspScanRules(dteMin: number, dteMax: number): CspRulesType {
  return { ...DEFAULT_CSP_RULES, IVR_MAX: CSP_SCAN_WIDE_IVR_MAX, DTE_MIN: dteMin, DTE_MAX: dteMax };
}

/** Raw, rule-independent score inputs captured at scan time (oiMin/ivrMin/ivrMax come from the view). */
export type CspScoreRawInputs = Omit<CspScoreInputs, 'oiMin' | 'ivrMin' | 'ivrMax'>;

const DELTA_REASON = /^Delta [\d.]+ is outside the preferred /;
const IVR_REASON = /exceeds the .*% CSP risk cap$/;
const OI_REASON = /^OI [\d,.]+ is below the preferred minimum of [\d,.]+\.?$/;

/**
 * Re-grade one scan-time CSP result against a view. Pure: returns the same object when the
 * result has nothing to re-grade (not a CSP result, or no candidate).
 */
export function regradeCspResult(r: ScreenResult, view: CspView): ScreenResult {
  const c = r.bestCandidate;
  if (r.strategy !== 'CSP' || !c) return r;

  const absDelta = Math.abs(c.shortDelta);
  const deltaPassing = absDelta >= view.deltaMin && absDelta <= view.deltaMax;

  // IVR cap = hide. Only ever escalates a market-qualified contract; an earnings/liquidity/
  // foundation disqualification is never softened by a looser cap.
  let market = c.cspMarketQualification;
  const ivrAboveCap = r.ivr != null && r.ivr > view.ivrMax;
  if (market && isMarketQualified(market) && ivrAboveCap) market = 'DISQUALIFIED_IVR';

  const raw = c.cspScoreInputs;
  const cspScore = raw
    ? calculateCspScore({ ...raw, oiMin: view.oiMin, ivrMin: view.ivrMin, ivrMax: view.ivrMax })
    : c.cspScore;

  const oiPassing = Number.isFinite(c.shortOI) ? c.shortOI >= view.oiMin : c.cspOiPassing;

  const failReasons = r.failReasons.filter((s) => !DELTA_REASON.test(s) && !IVR_REASON.test(s) && !OI_REASON.test(s));
  // AUDIT-TRUTH-0002: preferences (OI, delta) come AFTER the real disqualifiers, so the audit headline is the true
  // blocker; and the OI text states the VIEW's minimum, not the scan's built-in 500.
  const oiWarning = oiPassing ? null : `OI ${c.shortOI} is below the preferred minimum of ${view.oiMin}.`;
  if (oiWarning) failReasons.push(oiWarning);
  if (!deltaPassing) {
    failReasons.push(`Delta ${absDelta.toFixed(2)} is outside the preferred ${view.deltaMin.toFixed(2)}-${view.deltaMax.toFixed(2)} range`);
  }
  if (market === 'DISQUALIFIED_IVR' && c.cspMarketQualification !== 'DISQUALIFIED_IVR') {
    // AUDIT-TRUTH-0001: the disqualifier leads, so the audit never headlines an advisory (like low OI) as the reason.
    failReasons.unshift(`IVR ${r.ivr?.toFixed?.(1) ?? '—'}% exceeds the ${view.ivrMax}% CSP risk cap`);
  }

  const deltaCheck = deltaPassing
    ? { status: 'pass' as const, value: `Δ${c.shortDelta.toFixed(2)}`, reason: `Within preferred ${view.deltaMin}-${view.deltaMax}` }
    : { status: 'warn' as const, value: `Δ${c.shortDelta.toFixed(2)}`, reason: `Outside preferred ${view.deltaMin}-${view.deltaMax}` };

  const candidate = {
    ...c,
    cspDeltaTargetPassing: deltaPassing,
    cspMarketQualification: market,
    cspScore,
    cspOiPassing: oiPassing,
    cspOiWarning: oiWarning,
    cspAdvisoryWarnings: (c.cspAdvisoryWarnings ?? []).filter((w) => !OI_REASON.test(w)).concat(oiWarning ? [oiWarning] : []),
  };

  return {
    ...r,
    bestCandidate: candidate,
    failReasons,
    checks: {
      ...r.checks,
      delta: deltaCheck,
      // AUDIT-TRUTH-0002: the OI check row states the view's minimum, not the scan's built-in 500.
      oi: oiPassing
        ? { status: 'pass' as const, value: `${c.shortOI}`, reason: `≥ ${view.oiMin} minimum` }
        : { status: 'warn' as const, value: `${c.shortOI}`, reason: oiWarning ?? `Below ${view.oiMin} — fills may be difficult` },
    },
    // Same rule the scan applies: delta is a preference (Caution / not a Best Opportunity), never a
    // qualification gate. Only market state (IVR cap, earnings, liquidity) decides qualified.
    qualified: !!market && isOverallCspQualified(market, c.cspModeQualification ?? 'NOT_APPLICABLE'),
  };
}

/** View-side hide filters that are not grading: DTE window and period return. */
export function cspWithinViewWindow(r: ScreenResult, view: Pick<CspView, 'dteMin' | 'dteMax' | 'returnMin'>): boolean {
  const c = r.bestCandidate;
  if (r.strategy !== 'CSP' || !c) return true;
  if (c.dte < view.dteMin || c.dte > view.dteMax) return false;
  if (view.returnMin > 0 && !(c.roc >= view.returnMin)) return false;
  return true;
}

/** Re-grade every CSP result for the active view; non-CSP results pass through unchanged. */
export function regradeCspResults(results: ScreenResult[], view: CspView): ScreenResult[] {
  return results.map((r) => regradeCspResult(r, view));
}
