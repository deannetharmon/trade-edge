// lib/indicators/__tests__/rsiEntrySettings.test.ts

// RSI-ENTRY-0001 slice A2a: defaults, gate parameters, validation, and the receipt sentence.

import { describe, expect, it } from 'vitest';
import { RSI_ENTRY_PARAMS } from '../rsiEntryGate';
import {
  RSI_ENTRY_DEFAULTS,
  defaultRsiEntrySettings,
  isRsiEntrySettings,
  isRsiEntryValid,
  rsiEntryFieldErrors,
  rsiEntryParams,
  rsiEntrySummary,
} from '../rsiEntrySettings';

describe('defaults', () => {
  it('ship Off with the ticket values', () => {
    expect(RSI_ENTRY_DEFAULTS.CSP).toEqual({ on: false, level: 40, window: 8, lift: 3, mid: 50 });
    expect(RSI_ENTRY_DEFAULTS.CC).toEqual({ on: false, level: 60, window: 8, lift: 3, mid: 50 });
  });
  it('defaultRsiEntrySettings returns a copy, never the shared object', () => {
    const a = defaultRsiEntrySettings('CSP');
    a.on = true; a.level = 10;
    expect(RSI_ENTRY_DEFAULTS.CSP).toEqual({ on: false, level: 40, window: 8, lift: 3, mid: 50 });
  });
  it('default settings give exactly the gate parameter constants', () => {
    expect(rsiEntryParams('CSP', RSI_ENTRY_DEFAULTS.CSP)).toEqual(RSI_ENTRY_PARAMS.CSP);
    expect(rsiEntryParams('CC', RSI_ENTRY_DEFAULTS.CC)).toEqual(RSI_ENTRY_PARAMS.CC);
  });
  it('a custom CSP level moves only the low side; a custom CC level only the high side', () => {
    expect(rsiEntryParams('CSP', { on: true, level: 30, window: 10, lift: 4, mid: 45 })).toEqual({ low: 30, high: 70, window: 10, lift: 4, mid: 45 });
    expect(rsiEntryParams('CC', { on: true, level: 65, window: 10, lift: 4, mid: 55 })).toEqual({ low: 30, high: 65, window: 10, lift: 4, mid: 55 });
  });
});

describe('validation', () => {
  it('the defaults are valid for both strategies', () => {
    expect(isRsiEntryValid('CSP', RSI_ENTRY_DEFAULTS.CSP)).toBe(true);
    expect(isRsiEntryValid('CC', RSI_ENTRY_DEFAULTS.CC)).toBe(true);
  });
  it('CSP dip level: range and must sit below the ceiling', () => {
    const base = RSI_ENTRY_DEFAULTS.CSP;
    expect(rsiEntryFieldErrors('CSP', { ...base, level: 4 }).level).toMatch(/5 to 60/);
    expect(rsiEntryFieldErrors('CSP', { ...base, level: 61 }).level).toMatch(/5 to 60/);
    expect(rsiEntryFieldErrors('CSP', { ...base, level: 50 }).level).toMatch(/below the ceiling/);
    expect(rsiEntryFieldErrors('CSP', { ...base, level: 49 }).level).toBeUndefined();
    expect(rsiEntryFieldErrors('CSP', { ...base, level: 5 }).level).toBeUndefined();
  });
  it('CC peak level: range and must sit above the floor', () => {
    const base = RSI_ENTRY_DEFAULTS.CC;
    expect(rsiEntryFieldErrors('CC', { ...base, level: 39 }).level).toMatch(/40 to 95/);
    expect(rsiEntryFieldErrors('CC', { ...base, level: 96 }).level).toMatch(/40 to 95/);
    expect(rsiEntryFieldErrors('CC', { ...base, level: 50 }).level).toMatch(/above the floor/);
    expect(rsiEntryFieldErrors('CC', { ...base, level: 51 }).level).toBeUndefined();
  });
  it('window must be a whole number of 3 to 30 bars', () => {
    const base = RSI_ENTRY_DEFAULTS.CSP;
    for (const window of [2, 31, 7.5, NaN]) expect(rsiEntryFieldErrors('CSP', { ...base, window }).window).toBeDefined();
    for (const window of [3, 8, 30]) expect(rsiEntryFieldErrors('CSP', { ...base, window }).window).toBeUndefined();
  });
  it('lift is 1 to 20 points and the ceiling or floor is 30 to 70', () => {
    const base = RSI_ENTRY_DEFAULTS.CSP;
    for (const lift of [0, 0.5, 21, NaN]) expect(rsiEntryFieldErrors('CSP', { ...base, lift }).lift).toBeDefined();
    for (const lift of [1, 3, 20]) expect(rsiEntryFieldErrors('CSP', { ...base, lift }).lift).toBeUndefined();
    for (const mid of [29, 71, NaN]) expect(rsiEntryFieldErrors('CSP', { ...base, mid }).mid).toBeDefined();
    for (const mid of [30, 50, 70]) expect(rsiEntryFieldErrors('CSP', { ...base, mid, level: 29 }).mid).toBeUndefined();
  });
  it('a non-finite level is an error, not a pass', () => {
    expect(rsiEntryFieldErrors('CSP', { ...RSI_ENTRY_DEFAULTS.CSP, level: NaN }).level).toBe('Enter a number.');
  });
});

describe('isRsiEntrySettings', () => {
  it('accepts a complete setting and rejects anything malformed', () => {
    expect(isRsiEntrySettings({ on: true, level: 40, window: 8, lift: 3, mid: 50 })).toBe(true);
    for (const bad of [null, undefined, 5, 'x', [], {}, { on: 'yes', level: 40, window: 8, lift: 3, mid: 50 },
      { on: true, level: NaN, window: 8, lift: 3, mid: 50 }, { on: true, level: 40, window: 8, lift: 3 }]) {
      expect(isRsiEntrySettings(bad)).toBe(false);
    }
  });
});

describe('rsiEntrySummary', () => {
  it('always states Off', () => {
    expect(rsiEntrySummary('CSP', RSI_ENTRY_DEFAULTS.CSP)).toBe('RSI timing: Off');
    expect(rsiEntrySummary('CC', { ...RSI_ENTRY_DEFAULTS.CC, level: 70 })).toBe('RSI timing: Off');
  });
  it('On states the level, and the pass count when there are results', () => {
    expect(rsiEntrySummary('CSP', { ...RSI_ENTRY_DEFAULTS.CSP, on: true })).toBe('RSI timing: On · dip at or below 40');
    expect(rsiEntrySummary('CSP', { ...RSI_ENTRY_DEFAULTS.CSP, on: true }, { pass: 6, total: 24 })).toBe('RSI timing: On · dip at or below 40 · 6 of 24 pass');
    expect(rsiEntrySummary('CC', { ...RSI_ENTRY_DEFAULTS.CC, on: true }, { pass: 0, total: 3 })).toBe('RSI timing: On · peak at or above 60 · 0 of 3 pass');
  });
  it('spells out the turn rule only when it is not the default', () => {
    expect(rsiEntrySummary('CSP', { on: true, level: 30, window: 10, lift: 4, mid: 45 })).toBe('RSI timing: On · dip at or below 30 · turn rule: 10 bars, lift 4, below 45');
    expect(rsiEntrySummary('CC', { on: true, level: 60, window: 8, lift: 3, mid: 55 })).toBe('RSI timing: On · peak at or above 60 · turn rule: 8 bars, lift 3, above 55');
  });
});
