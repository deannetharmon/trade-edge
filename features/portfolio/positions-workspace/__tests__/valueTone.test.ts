// features/portfolio/positions-workspace/__tests__/valueTone.test.ts
//
// Ian's color rules by position type (2026-09-25). Colors are from the trader's side of the trade.

import { describe, expect, it } from 'vitest';
import { extrinsicTone, intrinsicTone, ivTone } from '../model/valueTone';
import type { ValueSplit } from '../model/extrinsic';

const split = (side: 'long' | 'short', intrinsic: [number | null, number], extrinsic: [number | null, number]): ValueSplit => ({
  side,
  intrinsic: { atEntry: intrinsic[0], now: intrinsic[1], change: intrinsic[0] == null ? null : intrinsic[1] - intrinsic[0] },
  extrinsic: { atEntry: extrinsic[0], now: extrinsic[1], change: extrinsic[0] == null ? null : extrinsic[1] - extrinsic[0] },
  extrinsicPctOfValue: null, extrinsicTotalNow: 0,
});

describe('bought options (LEAP, long call, long put, debit spread, PMCC): up is good', () => {
  it('intrinsic and extrinsic up are green, down are red', () => {
    const up = split('long', [2, 11], [12, 14]);
    expect(intrinsicTone({ split: up, loneShort: false })).toBe('positive');
    expect(extrinsicTone(up)).toBe('positive');
    const down = split('long', [11, 2], [14, 12]);
    expect(intrinsicTone({ split: down, loneShort: false })).toBe('negative');
    expect(extrinsicTone(down)).toBe('negative');
  });
  it('the stock falling toward the strike can raise extrinsic while intrinsic falls: green next to red, so the loss is not hidden', () => {
    const fell = split('long', [11, 4], [2, 5]);
    expect(extrinsicTone(fell)).toBe('positive');
    expect(intrinsicTone({ split: fell, loneShort: false })).toBe('negative');
  });
});

describe('sold options (CSP, short call, credit spread, iron condor): down is good', () => {
  it('intrinsic and extrinsic up are red, down are green (the decay is the profit)', () => {
    const worse = split('short', [0, 3], [2, 2.5]);
    expect(intrinsicTone({ split: worse, loneShort: false })).toBe('negative');
    expect(extrinsicTone(worse)).toBe('negative');
    const better = split('short', [3, 0], [2.5, 1]);
    expect(intrinsicTone({ split: better, loneShort: false })).toBe('positive');
    expect(extrinsicTone(better)).toBe('positive');
  });
});

describe('the Acquire or Wheel exception', () => {
  const itm = split('short', [0, 5], [2, 2]);
  it('a lone short put set to Acquire or Wheel: intrinsic up is the plan, so it stays neutral, but extrinsic keeps its color', () => {
    for (const intent of ['acquisition', 'wheel']) {
      expect(intrinsicTone({ split: itm, intent, loneShort: true })).toBe('neutral');
    }
    expect(extrinsicTone(split('short', [0, 5], [2, 3]))).toBe('negative');
  });
  it('an Income put, and a spread with the same intent value, still get the red', () => {
    expect(intrinsicTone({ split: itm, intent: 'income', loneShort: true })).toBe('negative');
    expect(intrinsicTone({ split: itm, intent: 'wheel', loneShort: false })).toBe('negative');
  });
  it('a bought option is not affected by intent', () => {
    expect(intrinsicTone({ split: split('long', [2, 11], [1, 1]), intent: 'wheel', loneShort: true })).toBe('positive');
  });
});

describe('IV follows the sign of net vega', () => {
  it('a long-vega position: IV up green, down red', () => {
    expect(ivTone(30, 36, 12)).toBe('positive');
    expect(ivTone(36, 30, 12)).toBe('negative');
  });
  it('a short-vega position: IV up red, down green', () => {
    expect(ivTone(30, 36, -9)).toBe('negative');
    expect(ivTone(36, 30, -9)).toBe('positive');
  });
  it('unknown or zero vega, missing values and no-change stay neutral', () => {
    expect(ivTone(30, 36, null)).toBe('neutral');
    expect(ivTone(30, 36, undefined)).toBe('neutral');
    expect(ivTone(30, 36, 0)).toBe('neutral');
    expect(ivTone(null, 36, 5)).toBe('neutral');
    expect(ivTone(30, 30, 5)).toBe('neutral');
  });
});

describe('missing entry values are neutral', () => {
  it('no colors without a comparison', () => {
    const s = split('long', [null, 11], [null, 2]);
    expect(intrinsicTone({ split: s, loneShort: false })).toBe('neutral');
    expect(extrinsicTone(s)).toBe('neutral');
  });
});
