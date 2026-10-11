// features/portfolio/positions-workspace/model/__tests__/equityEffect.test.ts

import { describe, it, expect } from 'vitest';
import { signedMoney, sumEquityEffect, equityEffectSortValue } from '../equityEffect';
import type { Position } from '@/lib/portfolio-data/types';

const pos = (mid: number | null | undefined, close: number | null | undefined) =>
  ({ equityEffectMid: mid, equityEffectClose: close } as unknown as Position);

describe('signedMoney', () => {
  it('signs credit (negative) and debit (positive)', () => {
    expect(signedMoney(-250)).toBe('−$250');
    expect(signedMoney(1200)).toBe('+$1,200');
    expect(signedMoney(0)).toBe('$0');
    expect(signedMoney(-0.4)).toBe('$0');
  });
  it('shows Unavailable for missing', () => {
    expect(signedMoney(null)).toBe('Unavailable');
    expect(signedMoney(undefined)).toBe('Unavailable');
  });
});

describe('sumEquityEffect', () => {
  it('nets credit spread, debit spread, long call, short put, PMCC', () => {
    const list = [pos(-180, -200), pos(300, 280), pos(500, 480), pos(-90, -100), pos(2000, 1950)];
    const mid = sumEquityEffect(list, 'mid');
    expect(mid.total).toBe(-180 + 300 + 500 - 90 + 2000);
    expect(mid.excluded).toBe(0);
    expect(sumEquityEffect(list, 'close').total).toBe(-200 + 280 + 480 - 100 + 1950);
  });
  it('excludes missing prices and one-sided quotes without fabricating', () => {
    const list = [pos(-100, null), pos(null, null), pos(200, 190)];
    const mid = sumEquityEffect(list, 'mid');
    expect(mid).toEqual({ total: 100, included: 2, excluded: 1 });
    const close = sumEquityEffect(list, 'close');
    expect(close).toEqual({ total: 190, included: 1, excluded: 2 });
  });
});

describe('equityEffectSortValue', () => {
  it('prefers close, falls back to mid, else null', () => {
    expect(equityEffectSortValue(pos(-10, -20))).toBe(-20);
    expect(equityEffectSortValue(pos(-10, null))).toBe(-10);
    expect(equityEffectSortValue(pos(null, null))).toBeNull();
  });
});
