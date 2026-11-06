// lib/scans/__tests__/cspView.test.ts
//
// SCAN-SIMPLIFY-0001 -- the view re-grade must equal what a scan graded under the same rules produced.

import { describe, it, expect } from 'vitest';
import { calculateCspScore } from '../cspScore';
import {
  CSP_VIEW_PRESETS, cspViewFromPreset, detectCspPreset, regradeCspResult, cspWithinViewWindow, cspScanRules,
} from '../cspView';
import type { ScreenResult } from '../types';
import { DEFAULT_CSP_RULES } from '../constants';

const RAW = {
  pop: 78, otmPct: 9, periodRocPct: 1.8, annualizedRocPct: 21, liquidityClass: 'STRONG' as const,
  openInterest: 409, technicalFit: 62, ivr: 40, earningsWithinExpiration: false,
};

function result(delta: number, over: Partial<ScreenResult> = {}): ScreenResult {
  return {
    symbol: 'AMD', strategy: 'CSP', price: 477, ivr: 40, qualified: true,
    bestCandidate: {
      shortDelta: -delta, shortOI: 409, dte: 35, roc: 1.8,
      cspMarketQualification: 'QUALIFIED', cspDeltaTargetPassing: true, cspOiPassing: false,
      cspScoreInputs: RAW,
      cspScore: calculateCspScore({ ...RAW, oiMin: 500, ivrMin: 30, ivrMax: 70 }),
    } as any,
    failReasons: [], checks: {} as any, ...over,
  } as ScreenResult;
}

describe('SCAN-SIMPLIFY-0001 cspView', () => {
  it('Balanced view reproduces the scan-time Balanced score exactly', () => {
    const r = result(0.22);
    const out = regradeCspResult(r, { ...cspViewFromPreset('balanced', 7, 60), ivrMin: DEFAULT_CSP_RULES.IVR_MIN }); // same preferred IVR floor as the scan
    expect(out.bestCandidate!.cspScore).toEqual(r.bestCandidate!.cspScore);
    expect(out.qualified).toBe(true);
  });

  it('delta outside the active band is Caution; widening the band restores it, without mutating the input', () => {
    const r = result(0.30);
    const bal = regradeCspResult(r, cspViewFromPreset('balanced', 7, 60));
    expect(bal.bestCandidate!.cspDeltaTargetPassing).toBe(false);
    expect(bal.qualified).toBe(true); // delta is a preference, not a qualification gate
    expect(bal.failReasons.some(s => /outside the preferred 0\.15-0\.25/.test(s))).toBe(true); // AUDIT-TRUTH-0002: preferences follow the real blockers
    const more = regradeCspResult(r, cspViewFromPreset('opportunity', 7, 60));
    expect(more.bestCandidate!.cspDeltaTargetPassing).toBe(true);
    expect(more.qualified).toBe(true);
    expect(r.bestCandidate!.cspDeltaTargetPassing).toBe(true);
  });

  it('score follows the view: OI preference and IVR band change the score', () => {
    const r = result(0.22);
    const strict = regradeCspResult(r, { ...cspViewFromPreset('balanced', 7, 60), oiMin: 5000 });
    const loose = regradeCspResult(r, { ...cspViewFromPreset('balanced', 7, 60), oiMin: 100 });
    expect(loose.bestCandidate!.cspScore!.total).toBeGreaterThan(strict.bestCandidate!.cspScore!.total as number);
  });

  it('IVR-FLAG-0001: IVR never hides a contract, at any value or setting', () => {
    const r = result(0.22, { ivr: 89.5 });
    for (const key of ['conservative', 'balanced', 'opportunity', 'all'] as const) {
      const out = regradeCspResult(r, cspViewFromPreset(key, 7, 60));
      expect(out.qualified).toBe(true);
      expect(out.bestCandidate!.cspMarketQualification).not.toBe('DISQUALIFIED_IVR');
      expect(out.failReasons.some((s) => /CSP risk cap/.test(s))).toBe(false);
    }
  });

  it('never softens an earnings or liquidity disqualification', () => {
    const r = result(0.22);
    (r.bestCandidate as any).cspMarketQualification = 'DISQUALIFIED_EARNINGS';
    r.qualified = false;
    const out = regradeCspResult(r, cspViewFromPreset('opportunity', 7, 60));
    expect(out.qualified).toBe(false);
  });

  it('DTE window and return minimum are view-side hide filters', () => {
    const r = result(0.22);
    expect(cspWithinViewWindow(r, { dteMin: 7, dteMax: 60, returnMin: 0 })).toBe(true);
    expect(cspWithinViewWindow(r, { dteMin: 40, dteMax: 60, returnMin: 0 })).toBe(false);
    expect(cspWithinViewWindow(r, { dteMin: 7, dteMax: 60, returnMin: 2 })).toBe(false);
  });

  it('presets round-trip through detectCspPreset; edits become Custom; scan rules lift the IVR cap', () => {
    for (const p of CSP_VIEW_PRESETS) expect(detectCspPreset(cspViewFromPreset(p.key, 7, 60))).toBe(p.key);
    expect(detectCspPreset({ ...cspViewFromPreset('balanced', 7, 60), deltaMax: 0.27 })).toBe('custom');
    const rules = cspScanRules(7, 60);
    expect(rules.IVR_MAX).toBe(100);
    expect([rules.DTE_MIN, rules.DTE_MAX]).toEqual([7, 60]);
  });

  it('non-CSP results pass through untouched', () => {
    const r = { ...result(0.22), strategy: 'CC' } as ScreenResult;
    expect(regradeCspResult(r, cspViewFromPreset('balanced', 7, 60))).toBe(r);
  });
});
