// lib/portfolio/__tests__/protectionOrders.test.ts

import { describe, expect, it } from 'vitest';
import {
  buildOcoBody, buildStopLimitBody, buildTargetLimitBody, protectionActionLabel, protectionKindIncludesStop,
  protectionKindIncludesTarget, resolveProtectionKind, stopLimitPrice, validateProtectionDirection,
  type CloseLegBody,
} from '../protectionOrders';

const legs: CloseLegBody[] = [
  { symbol: 'AAPL  261016P00200000', quantity: 1, action: 'Buy to Close', 'instrument-type': 'Equity Option' },
  { symbol: 'AAPL  261016P00195000', quantity: 1, action: 'Sell to Close', 'instrument-type': 'Equity Option' },
];

describe('resolveProtectionKind', () => {
  it('an existing GTC always means replace with OCO, whatever the checkboxes say', () => {
    for (const includeTarget of [true, false]) for (const includeStop of [true, false]) {
      expect(resolveProtectionKind({ hasExistingGtc: true, includeTarget, includeStop })).toBe('OCO_REPLACE');
    }
  });
  it('with no GTC the checkboxes pick the order', () => {
    expect(resolveProtectionKind({ hasExistingGtc: false, includeTarget: true, includeStop: true })).toBe('OCO_NEW');
    expect(resolveProtectionKind({ hasExistingGtc: false, includeTarget: false, includeStop: true })).toBe('STOP_ONLY');
    expect(resolveProtectionKind({ hasExistingGtc: false, includeTarget: true, includeStop: false })).toBe('TARGET_ONLY');
    expect(resolveProtectionKind({ hasExistingGtc: false, includeTarget: false, includeStop: false })).toBeNull();
  });
  it('knows which legs each kind contains', () => {
    expect(protectionKindIncludesStop('TARGET_ONLY')).toBe(false);
    expect(protectionKindIncludesTarget('STOP_ONLY')).toBe(false);
    for (const kind of ['OCO_NEW', 'OCO_REPLACE'] as const) {
      expect(protectionKindIncludesStop(kind)).toBe(true);
      expect(protectionKindIncludesTarget(kind)).toBe(true);
    }
  });
  it('labels every kind in plain language', () => {
    expect(protectionActionLabel('OCO_REPLACE')).toBe('Replace GTC with OCO');
    expect(protectionActionLabel('OCO_NEW')).toBe('Place OCO');
    expect(protectionActionLabel('STOP_ONLY')).toBe('Place stop only');
    expect(protectionActionLabel('TARGET_ONLY')).toBe('Place target only');
    expect(protectionActionLabel(null)).toBe('Nothing selected');
  });
});

describe('broker bodies (exact shapes the broker receives)', () => {
  it('stop limit: trigger as given, limit 10% above, GTC, Debit', () => {
    expect(buildStopLimitBody(legs, 4.02)).toEqual({
      'order-type': 'Stop Limit', 'time-in-force': 'GTC', 'stop-trigger': '4.02', price: '4.42', 'price-effect': 'Debit', legs,
    });
  });
  it('target: plain GTC Limit at the target price, Debit', () => {
    expect(buildTargetLimitBody(legs, 1.0)).toEqual({
      'order-type': 'Limit', 'time-in-force': 'GTC', price: '1.00', 'price-effect': 'Debit', legs,
    });
  });
  it('OCO: target leg first, stop leg second, the same legs in both', () => {
    const oco = buildOcoBody(legs, 1.0, 4.02);
    expect(oco.type).toBe('OCO');
    expect(oco.orders).toEqual([buildTargetLimitBody(legs, 1.0), buildStopLimitBody(legs, 4.02)]);
  });
  it('floors prices at one cent and rounds to cents', () => {
    expect(buildTargetLimitBody(legs, 0).price).toBe('0.01');
    expect(buildStopLimitBody(legs, 0)['stop-trigger']).toBe('0.01');
    expect(stopLimitPrice(2.505)).toBe('2.76');
    expect(stopLimitPrice(0.001)).toBe('0.01');
  });
});

describe('validateProtectionDirection', () => {
  const base = { liveValue: 2.5, stopTrigger: 4.02, targetLimit: 1.0 };
  it('accepts a target below and a stop above the live value', () => {
    for (const kind of ['OCO_NEW', 'OCO_REPLACE', 'STOP_ONLY', 'TARGET_ONLY'] as const) {
      expect(validateProtectionDirection({ kind, ...base })).toBeNull();
    }
  });
  it('rejects a stop at or below live and a target at or above live', () => {
    expect(validateProtectionDirection({ kind: 'STOP_ONLY', ...base, stopTrigger: 2.5 })).toContain('trigger immediately');
    expect(validateProtectionDirection({ kind: 'TARGET_ONLY', ...base, targetLimit: 2.5 })).toContain('fill immediately');
    expect(validateProtectionDirection({ kind: 'OCO_NEW', ...base, targetLimit: 3 })).toContain('fill immediately');
  });
  it('only checks the legs the kind actually places', () => {
    expect(validateProtectionDirection({ kind: 'STOP_ONLY', ...base, targetLimit: 9 })).toBeNull();
    expect(validateProtectionDirection({ kind: 'TARGET_ONLY', ...base, stopTrigger: 0.1 })).toBeNull();
  });
  it('rejects non-numbers and tolerates an unknown live value', () => {
    expect(validateProtectionDirection({ kind: 'STOP_ONLY', ...base, stopTrigger: NaN })).toContain('valid stop');
    expect(validateProtectionDirection({ kind: 'TARGET_ONLY', ...base, targetLimit: 0 })).toContain('valid profit target');
    expect(validateProtectionDirection({ kind: 'OCO_NEW', liveValue: null, stopTrigger: 4, targetLimit: 1 })).toBeNull();
  });
});
