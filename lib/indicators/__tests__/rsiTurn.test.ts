// lib/indicators/__tests__/rsiTurn.test.ts
//
// RSI-TURN-0001: golden fixtures from Alan's validation (2026-09-25). Expected values were computed by his
// independent reference implementation; RSI values are asserted to 2 decimals.

import { describe, expect, it } from 'vitest';
import { rsiSeries, RSI_MIN_CLOSES } from '../rsi';
import { classifyRsiTurn, describeRsiTurn, rsiState, RSI_TURN_PARAMS } from '../rsiTurn';

const range = (start: number, step: number, count: number) => Array.from({ length: count }, (_, i) => start + step * i);
/** RSI at close index k (RSI values begin at close index 14). */
const at = (closes: number[], k: number) => rsiSeries(closes)![k - 14];
/** State as of close index k, using only the RSI values available up to that bar. */
const stateAt = (closes: number[], k: number) => rsiState(rsiSeries(closes)!.slice(0, k - 14 + 1));

const BASE = [...Array.from({ length: 11 }, () => [100, 101]).flat(), 100];
const F5 = [...BASE, 99, 98, 97, 96, 95, 94, 93, 94, 95.5, 97, 98.5];
const F7 = [...BASE, 101, 102, 103, 104, 105, 106, 107.5, 109, 107.5, 106, 104.5, 103];
const F8 = [100, 99, 99.2, 98.2, 97.2, 97.4, 96.4, 95.4, 94.9, 95.1, 94.1, 93.1, 93.3, 92.3, 91.3, 91.6, 90.6, 89.6, 89.8, 88.8, 87.8, 86.8, 87.0, 86.0, 85.0, 85.2, 84.2, 83.2, 82.7, 82.9, 81.9, 80.9, 81.1, 80.1, 79.1, 79.4, 78.4, 77.4, 77.6, 76.6, 75.6];

describe('rsiSeries (Wilder RSI 14)', () => {
  it('F1 monotonic rise is 100 at every bar', () => {
    for (const v of rsiSeries(range(100, 1, 20))!) expect(v).toBe(100);
  });
  it('F2 monotonic fall is 0 at every bar', () => {
    for (const v of rsiSeries(range(100, -1, 20))!) expect(v).toBe(0);
  });
  it('F3 a flat series is 50', () => {
    for (const v of rsiSeries(Array.from({ length: 20 }, () => 100))!) expect(v).toBe(50);
  });
  it('F4 textbook series (exact Wilder arithmetic; about 0.06 under the published spreadsheet, which rounds intermediates)', () => {
    const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64];
    const expected = [70.46, 66.25, 66.48, 69.35, 66.29, 57.92];
    const series = rsiSeries(closes)!;
    expect(series).toHaveLength(6);
    series.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 2));
  });
  it('the hand calculation: seed averages 0.238571 and 0.1, RSI 70.46, then 66.25', () => {
    const series = rsiSeries([44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00])!;
    expect(100 - 100 / (1 + (3.34 / 14) / (1.4 / 14))).toBeCloseTo(70.46, 2);
    expect(series[1]).toBeCloseTo(66.25, 2);
  });
  it('does not round inside the function', () => {
    expect(String(rsiSeries([44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28])![0]).length).toBeGreaterThan(6);
  });
  it('fails closed: too few closes, empty, non-array, NaN, null, zero, negative, non-numeric, infinite', () => {
    expect(RSI_MIN_CLOSES).toBe(15);
    expect(rsiSeries(range(100, 1, 14))).toBeNull();
    expect(rsiSeries([])).toBeNull();
    expect(rsiSeries('nope')).toBeNull();
    expect(rsiSeries(undefined)).toBeNull();
    const good = range(100, 1, 20);
    for (const bad of [NaN, null, 0, -5, '101', Infinity]) {
      const closes = [...good] as unknown[];
      closes[7] = bad;
      expect(rsiSeries(closes)).toBeNull();
    }
    expect(rsiSeries(range(100, 1, 15))).toHaveLength(1);
  });
});

describe('rsiState on a real price path', () => {
  it('F5 V-bottom: NEUTRAL, then oversold no turn at the low, one rise is not enough, TURNING_UP for two bars, then the 50 ceiling ends it', () => {
    const expected: Array<[number, number, string]> = [
      [25, 39.37, 'NEUTRAL'], [26, 36.56, 'NEUTRAL'], [27, 33.95, 'NEUTRAL'], [28, 31.52, 'NEUTRAL'],
      [29, 29.27, 'OVERSOLD_NO_TURN'], [30, 34.32, 'NEUTRAL'], [31, 41.12, 'TURNING_UP'], [32, 47.02, 'TURNING_UP'], [33, 52.18, 'NEUTRAL'],
    ];
    for (const [k, r, state] of expected) {
      expect(at(F5, k), `RSI at ${k}`).toBeCloseTo(r, 2);
      expect(stateAt(F5, k), `state at ${k}`).toBe(state);
    }
  });
  it('F6 / F6b an unconfirmed V is never TURNING_UP', () => {
    expect(stateAt(F5, 29)).toBe('OVERSOLD_NO_TURN');
    expect(stateAt(F5, 30)).not.toBe('TURNING_UP');
    expect(at(F5, 30) - at(F5, 29)).toBeGreaterThan(5); // a lift over 5 with only one rise still does not count
  });
  it('F7 inverted V mirrors it: TURNING_DOWN for two bars, then the 50 floor ends it', () => {
    const expected: Array<[number, number, string]> = [
      [28, 67.42, 'NEUTRAL'], [29, 70.79, 'OVERBOUGHT_NO_TURN'], [30, 73.72, 'OVERBOUGHT_NO_TURN'], [31, 66.53, 'NEUTRAL'],
      [32, 60.22, 'TURNING_DOWN'], [33, 54.63, 'TURNING_DOWN'], [34, 49.67, 'NEUTRAL'],
    ];
    for (const [k, r, state] of expected) {
      expect(at(F7, k), `RSI at ${k}`).toBeCloseTo(r, 2);
      expect(stateAt(F7, k), `state at ${k}`).toBe(state);
    }
  });
  it('F8 twenty bars deep in oversold territory never reports a turn up; it ends OVERSOLD_NO_TURN', () => {
    const series = rsiSeries(F8)!;
    for (let k = 21; k <= 40; k += 1) {
      expect(series[k - 14]).toBeGreaterThan(7.5);
      expect(series[k - 14]).toBeLessThan(10.6);
      expect(stateAt(F8, k), `bar ${k}`).not.toBe('TURNING_UP');
    }
    expect(stateAt(F8, 40)).toBe('OVERSOLD_NO_TURN');
    expect(stateAt(F8, 35)).toBe('NEUTRAL'); // the known single-bar flicker: 3.02 above the window low after a single rise
    expect(at(F8, 35)).toBeCloseTo(10.54, 2);
  });
});

describe('rsiState thresholds (literal RSI arrays, window 8)', () => {
  const cases: Array<[string, number[], string]> = [
    ['B1 lift exactly 3.00', [40, 35, 30, 25, 26, 27, 27.5, 28], 'TURNING_UP'],
    ['B2 lift 2.99', [40, 35, 30, 25, 26, 27, 27.5, 27.99], 'OVERSOLD_NO_TURN'],
    ['B3 window low exactly on the low line', [50, 45, 40, 35, 30.0, 31, 32, 33.0], 'TURNING_UP'],
    ['B4 window low just above the low line', [50, 45, 40, 35, 30.01, 31, 32, 33.01], 'NEUTRAL'],
    ['B5 window low just below the low line', [50, 45, 40, 35, 29.99, 31, 32, 33.0], 'TURNING_UP'],
    ['B6 just below the 50 ceiling', [30, 35, 40, 45, 47, 48, 49, 49.99], 'TURNING_UP'],
    ['B7 exactly on the ceiling (strict)', [30, 35, 40, 45, 47, 48, 49, 50.0], 'NEUTRAL'],
    ['B8 high exactly on the high line, drop exactly 3.00', [50, 55, 60, 65, 70.0, 69, 68, 67.0], 'TURNING_DOWN'],
    ['B9 drop 2.99', [50, 55, 60, 65, 70.0, 69, 68, 67.01], 'OVERBOUGHT_NO_TURN'],
    ['B10 high just below the high line', [50, 55, 60, 65, 69.99, 69, 68, 66.99], 'NEUTRAL'],
    ['B11 exactly on the floor (strict)', [70, 65, 60, 57, 55, 53, 51, 50.0], 'NEUTRAL'],
    ['B12 just above the floor', [70, 65, 60, 57, 55, 53, 51, 50.01], 'TURNING_DOWN'],
    ['B13 a spike then falling', [45, 50, 55, 70, 68, 66, 64, 62], 'TURNING_DOWN'],
    ['B14 both extremes in the window, past the ceiling and floor', [10, 20, 30, 40, 70, 60, 50, 45.0], 'NEUTRAL'],
  ];
  it.each(cases)('%s', (_name, values, expected) => {
    expect(rsiState(values)).toBe(expected);
  });
  it('B15 / B16 the lift parameter is honored (5 instead of 3)', () => {
    const five = { ...RSI_TURN_PARAMS, lift: 5 };
    expect(rsiState([28, 29, 30, 27, 26, 25, 26, 27], five)).toBe('OVERSOLD_NO_TURN');
    expect(rsiState([40, 35, 30, 25, 26, 27, 28, 30.5])).toBe('TURNING_UP');
    expect(rsiState([40, 35, 30, 25, 26, 27, 28, 30.5], five)).toBe('TURNING_UP');
    expect(rsiState([40, 35, 30, 25, 26, 27, 28, 30], five)).toBe('TURNING_UP');
    expect(rsiState([40, 35, 30, 25, 26, 27, 28, 29.99], five)).toBe('OVERSOLD_NO_TURN');
  });
  it('B17 / B18 too few values, or a bad value inside the window, is INSUFFICIENT', () => {
    expect(rsiState([30, 31, 32, 33, 34, 35, 36])).toBe('INSUFFICIENT');
    expect(rsiState([40, 35, 30, NaN, 26, 27, 28, 29])).toBe('INSUFFICIENT');
    expect(rsiState([40, 35, 30, null, 26, 27, 28, 29])).toBe('INSUFFICIENT');
    expect(rsiState('x')).toBe('INSUFFICIENT');
  });
  it('a bad value older than the window does not matter', () => {
    expect(rsiState([NaN, 40, 35, 30, 25, 26, 27, 27.5, 28])).toBe('TURNING_UP');
  });
});

describe('classifyRsiTurn and describeRsiTurn', () => {
  it('returns null for unusable closes and for series too short to classify', () => {
    expect(classifyRsiTurn([1, 2, 3])).toBeNull();
    expect(classifyRsiTurn(range(100, 1, 15))).toBeNull(); // one RSI value, fewer than the 8-bar window
    expect(describeRsiTurn(null)).toBe('RSI n/a');
  });
  it('describes a turn up in plain words with the low and how long ago', () => {
    const result = classifyRsiTurn(F5.slice(0, 32))!; // through close #31, the first TURNING_UP bar
    expect(result.state).toBe('TURNING_UP');
    expect(result.extreme).toBeCloseTo(29.27, 2);
    expect(result.extremeBarsAgo).toBe(2);
    expect(describeRsiTurn(result)).toBe('RSI 41 · turned up from 29, 2 bars ago');
  });
  it('describes a turn down, oversold with no turn, and neutral', () => {
    expect(describeRsiTurn(classifyRsiTurn(F7.slice(0, 33)))).toBe('RSI 60 · turned down from 74, 2 bars ago');
    expect(describeRsiTurn(classifyRsiTurn(F8))).toContain('oversold');
    expect(describeRsiTurn(classifyRsiTurn(F8))).toContain('no turn yet');
    expect(describeRsiTurn(classifyRsiTurn(F5.slice(0, 26)))).toBe('RSI 39');
  });
  it('a flat 90-bar series is neutral at 50', () => {
    const result = classifyRsiTurn(Array.from({ length: 90 }, () => 100))!;
    expect(result.state).toBe('NEUTRAL');
    expect(result.latest).toBe(50);
    expect(result.extreme).toBeNull();
  });
});
