// lib/scans/__tests__/buyingPowerStatus.test.ts
// OBP-LINE-0001: the reported TQQQ case: $6,000 required against $4,473.66 option buying power.
import { describe, expect, it } from 'vitest';
import { buyingPowerStatus } from '../buyingPowerStatus';

describe('buyingPowerStatus', () => {
  it('the TQQQ CSP: $6,000 needed with $4,473.66 available is short by $1,526.34', () => {
    expect(buyingPowerStatus(4473.66, 6000)).toEqual({ state: 'short', remaining: -1526.34, shortBy: 1526.34 });
  });
  it('enough: reports what is left after the order', () => {
    expect(buyingPowerStatus(4403.88, 2800)).toEqual({ state: 'enough', remaining: 1603.88, shortBy: 0 });
  });
  it('exactly enough is enough, not short', () => {
    expect(buyingPowerStatus(2800, 2800)).toEqual({ state: 'enough', remaining: 0, shortBy: 0 });
  });
  it('unreported or invalid buying power is unknown, never a guess', () => {
    for (const v of [null, undefined, Number.NaN]) expect(buyingPowerStatus(v as any, 1000)).toEqual({ state: 'unknown', remaining: null, shortBy: 0 });
    expect(buyingPowerStatus(1000, Number.NaN).state).toBe('unknown');
  });
});
