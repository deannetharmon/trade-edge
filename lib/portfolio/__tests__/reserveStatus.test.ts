// lib/portfolio/__tests__/reserveStatus.test.ts

import { describe, expect, it } from 'vitest';
import { buildReserveStatus } from '../reserveStatus';

describe('buildReserveStatus', () => {
  it('is bad below 10%, with the shortfall to the floor', () => {
    const s = buildReserveStatus(5000, 100000)!;
    expect(s.tone).toBe('bad');
    expect(s.pct).toBeCloseTo(5);
    expect(s.shortfallToFloor).toBe(5000);
  });
  it('exactly 10% is watch, with no shortfall', () => {
    const s = buildReserveStatus(10000, 100000)!;
    expect(s.tone).toBe('watch');
    expect(s.shortfallToFloor).toBe(0);
  });
  it('just under 20% is watch, 20% is good', () => {
    expect(buildReserveStatus(19999, 100000)!.tone).toBe('watch');
    expect(buildReserveStatus(20000, 100000)!.tone).toBe('good');
  });
  it('is null when either figure is missing or net liq is not positive', () => {
    expect(buildReserveStatus(null, 100000)).toBeNull();
    expect(buildReserveStatus(5000, 0)).toBeNull();
    expect(buildReserveStatus(NaN, 100000)).toBeNull();
  });
});
