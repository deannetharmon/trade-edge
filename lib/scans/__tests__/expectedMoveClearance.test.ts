// lib/scans/__tests__/expectedMoveClearance.test.ts

// Expected-move context is information only. These fixtures are the safety net Quinn asked for: a future
// change that turns "inside the expected move" into a warning, a failure or a gate would disqualify the
// whole 0.15-0.25 delta band a premium seller normally trades, so the build must fail if it does.
// Numbers are Black-Scholes (r = 4%, lognormal): a short put clears the 1-SD expected move only at about
// 0.11-0.13 delta.

import { describe, expect, it } from 'vitest';
import { evaluateEmClearance } from '../checklist';
import { computeExpectedMove } from '../expectedMove';
import { deriveQualificationState, RANKED_SPREAD_GATE_KEYS } from '../qualificationState';
import type { CheckResult } from '../types';

function normInv(p: number): number {
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425, ph = 1 - pl;
  let q: number, r: number;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > ph) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Short put strike (price 100) for a given |delta|, IV (decimal) and DTE. */
function putStrikeForDelta(delta: number, iv: number, dte: number): number {
  const T = dte / 365;
  const d1 = normInv(1 - delta);
  return 100 * Math.exp(-d1 * iv * Math.sqrt(T) + (0.04 + iv * iv / 2) * T);
}

const candidate = (strategy: 'BPS' | 'BCS', shortStrike: number, iv: number, dte: number) => ({
  strategy, shortStrike, expectedMove: computeExpectedMove(100, iv * 100, dte),
});

describe('evaluateEmClearance', () => {
  it('outside the expected move passes; the text says so', () => {
    const c = evaluateEmClearance(candidate('BPS', 80, 0.45, 35), 100);
    expect(c.status).toBe('pass');
    expect(c.reason).toContain('outside the expected move');
  });

  it('inside the expected move is neutral information, never a failure or a warning', () => {
    const c = evaluateEmClearance(candidate('BPS', 90, 0.45, 35), 100);
    expect(c.status).toBe('pending');
    expect(c.value).toMatch(/inside EM/);
    expect(c.reason).toContain('normal at 0.15-0.25 delta');
    expect(c.reason).toContain('Information only');
    expect(c.reason).not.toContain('POP below 68%');
  });

  it('exactly at the boundary counts as outside; the call side mirrors the put side', () => {
    const em = computeExpectedMove(100, 45, 35)!;
    expect(evaluateEmClearance({ strategy: 'BPS', shortStrike: 100 - em, expectedMove: em }, 100).status).toBe('pass');
    expect(evaluateEmClearance({ strategy: 'BCS', shortStrike: 100 + em, expectedMove: em }, 100).status).toBe('pass');
    expect(evaluateEmClearance({ strategy: 'BCS', shortStrike: 100 + em - 1, expectedMove: em }, 100).status).toBe('pending');
    expect(evaluateEmClearance({ strategy: 'BCS', shortStrike: 120, expectedMove: em }, 100).status).toBe('pass');
  });

  it('a missing, zero or negative expected move, or a missing price, is neutral and says the data is unavailable', () => {
    for (const bad of [null, 0, -5]) {
      const c = evaluateEmClearance({ strategy: 'BPS', shortStrike: 90, expectedMove: bad }, 100);
      expect(c).toMatchObject({ status: 'pending', reason: 'IVx unavailable for this expiration' });
    }
    expect(evaluateEmClearance({ strategy: 'BPS', shortStrike: 90, expectedMove: 13.9 }, null).status).toBe('pending');
    expect(evaluateEmClearance(null, 100).status).toBe('pending');
  });
});

describe('survival: expected move can never empty a normal scan', () => {
  it('expected-move clearance is not one of the qualification gates', () => {
    expect(RANKED_SPREAD_GATE_KEYS as readonly string[]).not.toContain('emClearance');
  });

  it('the whole 0.05-0.60 delta ladder, at every IV and DTE, yields only pass or neutral, never warn or fail', () => {
    for (const iv of [0.2, 0.3, 0.45, 0.6]) {
      for (const dte of [21, 35, 45]) {
        for (let delta = 0.05; delta <= 0.6001; delta += 0.01) {
          const status = evaluateEmClearance(candidate('BPS', putStrikeForDelta(delta, iv, dte), iv, dte), 100).status;
          expect(['pass', 'pending'], `iv ${iv} dte ${dte} delta ${delta.toFixed(2)}`).toContain(status);
        }
      }
    }
  });

  it('the normal 0.15-0.25 delta band stays Qualified when every other gate passes, whatever the expected move says', () => {
    const pass: CheckResult = { status: 'pass', value: 'x', reason: 'x' };
    let insideCount = 0;
    for (const iv of [0.25, 0.45, 0.6]) {
      for (const dte of [21, 35, 45]) {
        for (let delta = 0.15; delta <= 0.2501; delta += 0.01) {
          const em = evaluateEmClearance(candidate('BPS', putStrikeForDelta(delta, iv, dte), iv, dte), 100);
          if (em.status === 'pending') insideCount += 1;
          const checks = { ivr: pass, earnings: pass, oi: pass, roc: pass, emClearance: em };
          expect(deriveQualificationState(checks, RANKED_SPREAD_GATE_KEYS).state, `iv ${iv} dte ${dte} delta ${delta.toFixed(2)}`).toBe('qualified');
        }
      }
    }
    // Documents why a gate would be wrong: nearly the whole normal band is inside the 1-SD move.
    expect(insideCount).toBeGreaterThan(80);
  });

  it('missing expected-move data changes nothing about the state', () => {
    const pass: CheckResult = { status: 'pass', value: 'x', reason: 'x' };
    const unavailable = evaluateEmClearance({ strategy: 'BPS', shortStrike: 90, expectedMove: null }, 100);
    expect(deriveQualificationState({ ivr: pass, earnings: pass, oi: pass, roc: pass, emClearance: unavailable }, RANKED_SPREAD_GATE_KEYS).state).toBe('qualified');
  });
});
