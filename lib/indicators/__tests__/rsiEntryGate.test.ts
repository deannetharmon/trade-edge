// lib/indicators/__tests__/rsiEntryGate.test.ts

// RSI-ENTRY-0001 slice A1. Golden closes were checked against an independent Python implementation of Wilder RSI(14)
// and of the gate rule (written from the ticket text, not from the TypeScript); the RSI tails below are its output.

import { describe, expect, it } from 'vitest';
import { rsiSeries } from '../rsi';
import { RSI_TURN_PARAMS } from '../rsiTurn';
import {
  RSI_ENTRY_PARAMS,
  describeEntryGateOverride,
  evaluateRsiEntryGate,
  evaluateRsiEntryGateFromSeries,
} from '../rsiEntryGate';

const BASE = Array.from({ length: 21 }, (_, i) => (i % 2 === 0 ? 100 : 101)); // 21 closes, RSI near 50
const G = {
  cspPass: [...BASE, 99, 98, 97, 96, 95, 94, 93, 94, 95.5, 97.5],
  cspFalling: [...BASE, 99, 98, 97, 96, 95, 94, 93, 92],
  cspNoDip: [...BASE, 101, 102, 103, 104, 105, 104, 103, 102],
  cspBounced: [...BASE, 99, 98, 97, 96, 95, 94, 93, 95, 98, 101, 104],
  cspNotConf: [...BASE, 99, 98, 97, 96, 95, 94, 93, 95, 94.5, 96],
  ccPass: [...BASE, 101, 102, 103, 104, 105, 106, 107, 106, 104.5, 102.5],
  ccRising: [...BASE, 101, 102, 103, 104, 105, 106, 107, 108],
  ccNoPeak: [...BASE, 99, 98, 97, 96, 95, 94, 93, 92],
  ccFaded: [...BASE, 101, 102, 103, 104, 105, 106, 107, 105, 102, 99, 96],
  ccNotConf: [...BASE, 101, 102, 103, 104, 105, 106, 107, 105, 105.5, 104],
};
const tail8 = (closes: number[]) => rsiSeries(closes)!.slice(-8).map((v) => Math.round(v * 100) / 100);

describe('golden closes: RSI agrees with the independent reference', () => {
  it('matches the Python tails to 2 decimals', () => {
    expect(tail8(G.cspPass)).toEqual([39.5, 36.68, 34.06, 31.63, 29.37, 34.41, 41.2, 48.8]);
    expect(tail8(G.cspFalling)).toEqual([45.81, 42.54, 39.5, 36.68, 34.06, 31.63, 29.37, 27.27]);
    expect(tail8(G.cspNoDip)).toEqual([52.95, 56.31, 59.43, 62.33, 65.02, 60.38, 56.07, 52.06]);
    expect(tail8(G.cspBounced)).toEqual([36.68, 34.06, 31.63, 29.37, 38.79, 49.63, 57.71, 63.93]);
    expect(tail8(G.cspNotConf)).toEqual([39.5, 36.68, 34.06, 31.63, 29.37, 38.79, 37.44, 43.74]);
    expect(tail8(G.ccPass)).toEqual([59.43, 62.33, 65.02, 67.52, 69.84, 64.85, 58.14, 50.62]);
    expect(tail8(G.ccRising)).toEqual([52.95, 56.31, 59.43, 62.33, 65.02, 67.52, 69.84, 72.0]);
    expect(tail8(G.ccFaded)).toEqual([62.33, 65.02, 67.52, 69.84, 60.53, 49.8, 41.82, 35.67]);
    expect(tail8(G.ccNotConf)).toEqual([59.43, 62.33, 65.02, 67.52, 69.84, 60.53, 61.9, 55.66]);
  });
});

describe('truth table from closes', () => {
  const cases: Array<[string, 'CSP' | 'CC', number[], string, string]> = [
    ['CSP pass', 'CSP', G.cspPass, 'PASS', 'TURNED_UP'],
    ['CSP falling', 'CSP', G.cspFalling, 'WAIT', 'STILL_FALLING'],
    ['CSP no dip', 'CSP', G.cspNoDip, 'WAIT', 'NO_DIP'],
    ['CSP bounced', 'CSP', G.cspBounced, 'WAIT', 'BOUNCED'],
    ['CSP not confirmed', 'CSP', G.cspNotConf, 'WAIT', 'TURN_NOT_CONFIRMED'],
    ['CC pass', 'CC', G.ccPass, 'PASS', 'TURNED_DOWN'],
    ['CC rising', 'CC', G.ccRising, 'WAIT', 'STILL_RISING'],
    ['CC no peak', 'CC', G.ccNoPeak, 'WAIT', 'NO_PEAK'],
    ['CC faded', 'CC', G.ccFaded, 'WAIT', 'FADED'],
    ['CC not confirmed', 'CC', G.ccNotConf, 'WAIT', 'TURN_NOT_CONFIRMED'],
  ];
  it.each(cases)('%s', (_name, strategy, closes, verdict, reason) => {
    const r = evaluateRsiEntryGate(strategy, closes);
    expect(r.verdict).toBe(verdict);
    expect(r.reason).toBe(reason);
  });
  it('a CSP pass is not a CC pass and the reverse (the strategies are not interchangeable)', () => {
    expect(evaluateRsiEntryGate('CC', G.cspPass).verdict).toBe('WAIT');
    expect(evaluateRsiEntryGate('CSP', G.ccPass).verdict).toBe('WAIT');
  });
});

describe('labels', () => {
  it('Pass uses the describeRsiTurn sentence', () => {
    expect(evaluateRsiEntryGate('CSP', G.cspPass).label).toBe('RSI 49 · turned up from 29, 3 bars ago');
    expect(evaluateRsiEntryGate('CC', G.ccPass).label).toBe('RSI 51 · turned down from 70, 3 bars ago');
  });
  it('Wait reads "Wait · reason (RSI n)" with the latest RSI rounded', () => {
    expect(evaluateRsiEntryGate('CSP', G.cspNoDip).label).toBe('Wait · no dip (RSI 52)');
    expect(evaluateRsiEntryGate('CSP', G.cspFalling).label).toBe('Wait · still falling (RSI 27)');
    expect(evaluateRsiEntryGate('CSP', G.cspBounced).label).toBe('Wait · bounced (RSI 64)');
    expect(evaluateRsiEntryGate('CSP', G.cspNotConf).label).toBe('Wait · turn not confirmed (RSI 44)');
    expect(evaluateRsiEntryGate('CC', G.ccNoPeak).label).toBe('Wait · no peak (RSI 27)');
    expect(evaluateRsiEntryGate('CC', G.ccRising).label).toBe('Wait · still rising (RSI 72)');
    expect(evaluateRsiEntryGate('CC', G.ccFaded).label).toBe('Wait · faded (RSI 36)');
    expect(evaluateRsiEntryGate('CC', G.ccNotConf).label).toBe('Wait · turn not confirmed (RSI 56)');
  });
  it('exposes the window extreme for the caller', () => {
    const r = evaluateRsiEntryGate('CSP', G.cspPass);
    expect(r.extreme).toBeCloseTo(29.37, 2);
    expect(r.extremeBarsAgo).toBe(3);
    expect(r.latest).toBeCloseTo(48.8, 1);
  });
});

// Eight RSI values, oldest first, so every boundary is hit exactly.
describe('CSP exact boundaries (dip level 40, lift 3, ceiling 50)', () => {
  const run = (w: number[]) => evaluateRsiEntryGateFromSeries('CSP', w);
  it('window low exactly 40 counts as a dip; 40.01 does not', () => {
    expect(run([50, 47, 44, 40, 41, 41.5, 42, 43]).verdict).toBe('PASS');
    expect(run([50, 47, 44, 40.01, 41, 41.5, 42, 43.01]).reason).toBe('NO_DIP');
  });
  it('lift exactly 3 passes; 2.99 is still falling', () => {
    expect(run([50, 47, 44, 40, 41, 41.5, 42, 43]).verdict).toBe('PASS');
    expect(run([50, 47, 44, 40, 41, 41.5, 42, 42.99])).toMatchObject({ verdict: 'WAIT', reason: 'STILL_FALLING' });
  });
  it('latest exactly 50 is bounced; 49.99 passes', () => {
    expect(run([50, 47, 44, 40, 44, 47, 49, 50])).toMatchObject({ verdict: 'WAIT', reason: 'BOUNCED' });
    expect(run([50, 47, 44, 40, 44, 47, 49, 49.99]).verdict).toBe('PASS');
  });
  it('a flat bar in the rise run breaks the confirmation', () => {
    expect(run([50, 47, 44, 40, 41, 42, 42, 44])).toMatchObject({ verdict: 'WAIT', reason: 'TURN_NOT_CONFIRMED' });
  });
  it('a dip in the latest bar is not a turn', () => {
    expect(run([50, 47, 44, 40, 42, 45, 44, 43.5])).toMatchObject({ verdict: 'WAIT', reason: 'TURN_NOT_CONFIRMED' });
  });
  it('only the last 8 values count; older history is ignored', () => {
    expect(run([10, 20, 90, 95, 50, 47, 44, 40, 41, 41.5, 42, 43]).verdict).toBe('PASS');
  });
});

describe('CC exact boundaries (peak level 60, lift 3, floor 50)', () => {
  const run = (w: number[]) => evaluateRsiEntryGateFromSeries('CC', w);
  it('window high exactly 60 counts as a peak; 59.99 does not', () => {
    expect(run([50, 53, 56, 60, 59, 58.5, 58, 57]).verdict).toBe('PASS');
    expect(run([50, 53, 56, 59.99, 59, 58.5, 58, 56.99])).toMatchObject({ verdict: 'WAIT', reason: 'NO_PEAK' });
  });
  it('drop exactly 3 passes; 2.99 is still rising', () => {
    expect(run([50, 53, 56, 60, 59, 58.5, 58, 57]).verdict).toBe('PASS');
    expect(run([50, 53, 56, 60, 59, 58.5, 58, 57.01])).toMatchObject({ verdict: 'WAIT', reason: 'STILL_RISING' });
  });
  it('latest exactly 50 is faded; 50.01 passes', () => {
    expect(run([40, 46, 56, 60, 58, 55, 52, 50])).toMatchObject({ verdict: 'WAIT', reason: 'FADED' });
    expect(run([40, 46, 56, 60, 58, 55, 52, 50.01]).verdict).toBe('PASS');
  });
  it('a flat bar in the fall run breaks the confirmation', () => {
    expect(run([50, 53, 60, 59, 58, 57, 57, 54])).toMatchObject({ verdict: 'WAIT', reason: 'TURN_NOT_CONFIRMED' });
  });
});

describe('fail closed', () => {
  it('too few closes is unavailable', () => {
    for (const s of ['CSP', 'CC'] as const) {
      const r = evaluateRsiEntryGate(s, [100, 101, 102]);
      expect(r).toMatchObject({ verdict: 'UNAVAILABLE', reason: 'UNAVAILABLE', label: 'RSI n/a', latest: null });
    }
  });
  it('exactly 15 closes gives one RSI value, which is not enough for the 8-value window', () => {
    expect(evaluateRsiEntryGate('CSP', BASE.slice(0, 15)).verdict).toBe('UNAVAILABLE');
  });
  it('empty, null, undefined and non-array closes are unavailable', () => {
    for (const bad of [[], null, undefined, 5, 'x', {}]) {
      expect(evaluateRsiEntryGate('CSP', bad).verdict).toBe('UNAVAILABLE');
      expect(evaluateRsiEntryGate('CC', bad).verdict).toBe('UNAVAILABLE');
    }
  });
  it('a non-finite or non-positive close anywhere makes it unavailable, never a pass', () => {
    for (const bad of [NaN, Infinity, null, -1, 0, '97.5']) {
      const closes = [...G.cspPass] as unknown[];
      closes[10] = bad;
      expect(evaluateRsiEntryGate('CSP', closes).verdict).toBe('UNAVAILABLE');
    }
  });
  it('a non-finite value in the RSI window is unavailable', () => {
    expect(evaluateRsiEntryGateFromSeries('CSP', [50, 47, 44, 40, 41, NaN, 42, 43]).verdict).toBe('UNAVAILABLE');
    expect(evaluateRsiEntryGateFromSeries('CSP', [1, 2, 3]).verdict).toBe('UNAVAILABLE');
    expect(evaluateRsiEntryGateFromSeries('CSP', null).verdict).toBe('UNAVAILABLE');
  });
  it('an unknown strategy is unavailable', () => {
    expect(evaluateRsiEntryGate('PMCC' as never, G.cspPass).verdict).toBe('UNAVAILABLE');
  });
  it('invalid parameters are unavailable', () => {
    const w = [50, 47, 44, 40, 41, 41.5, 42, 43];
    expect(evaluateRsiEntryGateFromSeries('CSP', w, { ...RSI_ENTRY_PARAMS.CSP, low: NaN }).verdict).toBe('UNAVAILABLE');
    expect(evaluateRsiEntryGateFromSeries('CSP', w, { ...RSI_ENTRY_PARAMS.CSP, window: 2 }).verdict).toBe('UNAVAILABLE');
    expect(evaluateRsiEntryGateFromSeries('CSP', w, { ...RSI_ENTRY_PARAMS.CSP, window: 7.5 }).verdict).toBe('UNAVAILABLE');
    expect(evaluateRsiEntryGateFromSeries('CSP', w, { ...RSI_ENTRY_PARAMS.CSP, lift: -1 }).verdict).toBe('UNAVAILABLE');
  });
});

describe('parameters', () => {
  it('ships the ticket values', () => {
    expect(RSI_ENTRY_PARAMS.CSP).toEqual({ low: 40, high: 70, window: 8, lift: 3, mid: 50 });
    expect(RSI_ENTRY_PARAMS.CC).toEqual({ low: 30, high: 60, window: 8, lift: 3, mid: 50 });
  });
  it('leaves RSI_TURN_PARAMS untouched', () => {
    expect(RSI_TURN_PARAMS).toEqual({ low: 30, high: 70, window: 8, lift: 3, mid: 50 });
  });
  it('a custom dip level changes the verdict (30 vs 40 for the pre-ship pass-rate check)', () => {
    const w = [50, 47, 44, 38, 40, 41, 42, 43];
    expect(evaluateRsiEntryGateFromSeries('CSP', w).verdict).toBe('PASS'); // dip 38 <= 40
    expect(evaluateRsiEntryGateFromSeries('CSP', w, { ...RSI_ENTRY_PARAMS.CSP, low: 30 })).toMatchObject({ verdict: 'WAIT', reason: 'NO_DIP' });
  });
  it('does not mutate its input', () => {
    const w = [50, 47, 44, 40, 41, 41.5, 42, 43];
    const copy = [...w];
    evaluateRsiEntryGateFromSeries('CSP', w);
    expect(w).toEqual(copy);
  });
});

describe('describeEntryGateOverride (order window line and audit text)', () => {
  it('says nothing for a Pass or for no result', () => {
    expect(describeEntryGateOverride(evaluateRsiEntryGate('CSP', G.cspPass))).toBeNull();
    expect(describeEntryGateOverride(null)).toBeNull();
    expect(describeEntryGateOverride(undefined)).toBeNull();
  });
  it('a Wait reads the way the approved mock does, with the reason and the rounded RSI', () => {
    expect(describeEntryGateOverride(evaluateRsiEntryGate('CSP', G.cspNoDip))).toEqual({
      line: 'RSI timing: Wait (no dip, RSI 52). Placing anyway.',
      audit: 'Entered with RSI gate = Wait (no dip)',
    });
    expect(describeEntryGateOverride(evaluateRsiEntryGate('CC', G.ccRising))?.audit).toBe('Entered with RSI gate = Wait (still rising)');
    expect(describeEntryGateOverride(evaluateRsiEntryGate('CSP', G.cspNotConf))?.line).toBe('RSI timing: Wait (turn not confirmed, RSI 44). Placing anyway.');
  });
  it('no usable RSI is n/a, not Wait', () => {
    expect(describeEntryGateOverride(evaluateRsiEntryGate('CSP', [1, 2, 3]))).toEqual({
      line: 'RSI timing: n/a (not enough price history). Placing anyway.',
      audit: 'Entered with RSI gate = n/a',
    });
  });
});
